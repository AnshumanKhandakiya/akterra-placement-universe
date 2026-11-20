"""Supabase persistence, email verification, and account services."""

from __future__ import annotations

import os
import secrets
import smtplib
import ssl
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Any
from urllib.parse import urlparse

import httpx
import streamlit as st
from postgrest.exceptions import APIError
from supabase import Client, create_client

from akterra_core import (
    build_leaderboard,
    domain_from_email,
    hash_otp,
    hash_password,
    normalize_email,
    valid_email,
    valid_username,
    verify_password,
)


class AkterraError(Exception):
    """Expected, user-facing application error."""


class ConfigurationError(AkterraError):
    pass


class DatabaseError(AkterraError):
    pass


class ConflictError(AkterraError):
    pass


class EmailDeliveryError(AkterraError):
    pass


class OtpError(AkterraError):
    pass


def setting(name: str, default: str = "") -> str:
    try:
        value = st.secrets.get(name)
    except (AttributeError, FileNotFoundError):
        value = None
    if value is not None and str(value).strip():
        return str(value)
    return os.environ.get(name, default)


@st.cache_resource
def _client(url: str, service_key: str) -> Client:
    return create_client(url, service_key)


def get_client() -> Client:
    url = setting("SUPABASE_URL").strip()
    service_key = setting("SUPABASE_SERVICE_ROLE_KEY").strip()
    if not url or not service_key:
        raise ConfigurationError(
            "Supabase is not configured. Add SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY to Streamlit secrets."
        )
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ConfigurationError("SUPABASE_URL must be a valid HTTPS project URL.")
    return _client(url, service_key)


def _execute(query: Any) -> list[dict[str, Any]]:
    try:
        return query.execute().data or []
    except APIError as error:
        code = str(getattr(error, "code", "") or "")
        if code == "23505":
            raise ConflictError("An account already uses this email or username.") from error
        message = str(getattr(error, "message", "") or "")
        if code == "P0001" and message:
            raise AkterraError(message) from error
        raise DatabaseError(
            "Supabase rejected the request. Check that the database schema is current."
        ) from error
    except (httpx.HTTPError, OSError, TimeoutError) as error:
        raise DatabaseError(
            "Akterra could not reach Supabase. Check the project URL and network settings."
        ) from error


def _first(query: Any) -> dict[str, Any] | None:
    rows = _execute(query.limit(1))
    return rows[0] if rows else None


def _otp_secret() -> str:
    secret = setting("OTP_HMAC_SECRET").strip() or setting("SUPABASE_SERVICE_ROLE_KEY").strip()
    if not secret:
        raise ConfigurationError("Configure Supabase before requesting an email verification code.")
    if len(secret) < 32 or secret.lower().startswith("replace-with"):
        raise ConfigurationError("Set OTP_HMAC_SECRET to a random value of at least 32 characters.")
    return secret


def registered_college_for_email(email: str) -> bool:
    domain = domain_from_email(email)
    return _first(
        get_client().table("college_domains").select("domain").eq("domain", domain)
    ) is not None


def college_for_domain(email: str) -> str | None:
    domain = domain_from_email(email)
    row = _first(
        get_client()
        .table("college_domains")
        .select("college_id")
        .eq("domain", domain)
    )
    return str(row["college_id"]) if row else None


def college_account_exists_for_domain(email: str) -> bool:
    domain = domain_from_email(email)
    domain_row = _first(
        get_client()
        .table("college_domains")
        .select("college_id")
        .eq("domain", domain)
    )
    if not domain_row:
        return False
    return _first(
        get_client()
        .table("users")
        .select("id")
        .eq("role", "college")
        .eq("college_id", domain_row["college_id"])
    ) is not None


def username_available(username: str, role: str) -> bool:
    if not valid_username(username) or role not in {"student", "college"}:
        return False
    return _first(
        get_client()
        .table("users")
        .select("id")
        .eq("role", role)
        .eq("username", username.strip().lower())
    ) is None


def email_available(email: str, role: str) -> bool:
    if not valid_email(email) or role not in {"student", "college", "company"}:
        return False
    return _first(
        get_client()
        .table("users")
        .select("id")
        .eq("role", role)
        .eq("email", normalize_email(email))
    ) is None


def _send_email(recipient: str, subject: str, code: str) -> None:
    host = setting("SMTP_HOST", "smtp.gmail.com").strip()
    try:
        port = int(setting("SMTP_PORT", "587"))
    except ValueError as error:
        raise ConfigurationError("SMTP_PORT must be a valid port number.") from error
    username = setting("SMTP_USER").strip()
    password = setting("SMTP_PASSWORD")
    sender = setting("SMTP_FROM").strip() or username
    if not host or not username or not password or not sender:
        raise ConfigurationError(
            "Email verification is not configured. Add SMTP_USER and SMTP_PASSWORD "
            "(for Gmail, use an app password) to Streamlit secrets."
        )
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"Akterra Placement Universe <{sender}>"
    message["To"] = recipient
    message.set_content(
        f"Your Akterra verification code is {code}. It expires in 5 minutes. "
        "If you did not request this, ignore this email."
    )
    try:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            server.login(username, password)
            server.send_message(message)
    except (smtplib.SMTPException, OSError, TimeoutError) as error:
        raise EmailDeliveryError(
            "Email could not be sent. Check the SMTP settings and try again."
        ) from error


def send_email_otp(email: str, purpose: str) -> None:
    normalized = normalize_email(email)
    if not valid_email(normalized):
        raise AkterraError("Enter a valid email address.")
    if purpose not in {"student_register", "college_register"} and not purpose.startswith(
        "college_domain:"
    ):
        raise AkterraError("Invalid email verification request.")

    client = get_client()
    code = f"{secrets.randbelow(1_000_000):06d}"
    reservation = _execute(
        client.rpc(
            "reserve_email_otp",
            {
                "p_purpose": purpose,
                "p_email": normalized,
                "p_code_hash": hash_otp(code, _otp_secret()),
            },
        )
    )
    status = reservation[0]["status"] if reservation else ""
    if status == "too_soon":
        raise OtpError("Please wait one minute before requesting another code.")
    if status == "hour_limit":
        raise OtpError("You can request up to 3 verification codes per hour.")
    if status != "reserved":
        raise DatabaseError("Could not reserve an email verification code.")
    try:
        _send_email(normalized, "Your Akterra verification code", code)
    except AkterraError:
        _execute(
            client.table("email_otps")
            .update(
                {
                    "code_hash": "0" * 64,
                    "expires_at": datetime.now(timezone.utc).isoformat(),
                    "attempts": 5,
                    "verified_at": None,
                }
            )
            .eq("purpose", purpose)
            .eq("email", normalized)
        )
        raise


def verify_email_otp(email: str, purpose: str, code: str) -> None:
    normalized = normalize_email(email)
    if not code.isdigit() or len(code) != 6:
        raise OtpError("Enter the 6-digit code from your email.")
    status_rows = _execute(
        get_client().rpc(
            "verify_email_otp",
            {
                "p_purpose": purpose,
                "p_email": normalized,
                "p_code_hash": hash_otp(code, _otp_secret()),
            },
        )
    )
    status = status_rows[0]["status"] if status_rows else ""
    if status == "expired":
        raise OtpError("That code has expired. Request a new email verification code.")
    if status == "locked":
        raise OtpError("Too many incorrect attempts. Request a new code.")
    if status == "incorrect":
        raise OtpError("That code does not match. Check your email and try again.")
    if status != "verified":
        raise DatabaseError("Email verification did not return a valid result.")


def _register_with_otp(
    rpc_name: str,
    parameters: dict[str, Any],
    email: str,
) -> dict[str, Any]:
    if not valid_email(email):
        raise AkterraError("Enter a valid email address.")
    if not valid_username(parameters["p_username"]):
        raise AkterraError("Username must be 3 to 32 characters and use letters, numbers, dots, underscores, or hyphens.")
    if len(parameters.get("p_password", "")) < 8:
        raise AkterraError("Password must contain at least 8 characters.")
    salt, password_hash = hash_password(parameters.pop("p_password"))
    parameters["p_email"] = normalize_email(email)
    parameters["p_password_salt"] = salt
    parameters["p_password_hash"] = password_hash
    result = _execute(get_client().rpc(rpc_name, parameters))
    if not result:
        raise DatabaseError("Account creation did not return a result.")
    return result[0]


def register_student(email: str, username: str, password: str) -> dict[str, Any]:
    if len(password) < 8 or len(password) > 128:
        raise AkterraError("Password must be between 8 and 128 characters.")
    return _register_with_otp(
        "register_student_account",
        {"p_username": username, "p_password": password},
        email,
    )


def register_college(
    email: str, college_name: str, username: str, password: str
) -> dict[str, Any]:
    if not 3 <= len(college_name.strip()) <= 120:
        raise AkterraError("Enter a college name between 3 and 120 characters.")
    if len(password) < 8 or len(password) > 128:
        raise AkterraError("Password must be between 8 and 128 characters.")
    return _register_with_otp(
        "register_college_account",
        {"p_college_name": college_name.strip(), "p_username": username, "p_password": password},
        email,
    )


def register_company(
    email: str,
    password: str,
    company_name: str,
    contact_name: str,
    job_title: str,
    industry: str,
    website: str,
    work_details: str,
) -> dict[str, Any]:
    normalized = normalize_email(email)
    if not valid_email(normalized):
        raise AkterraError("Enter a valid official company email.")
    fields = (
        (company_name, 2, 120, "company name"),
        (contact_name, 2, 100, "contact person name"),
        (job_title, 2, 100, "contact person job title"),
        (industry, 2, 100, "company industry"),
        (work_details, 10, 2000, "work and hiring details"),
    )
    for value, minimum, maximum, label in fields:
        if not minimum <= len(value.strip()) <= maximum:
            raise AkterraError(f"Enter {label} using {minimum} to {maximum} characters.")
    if not 8 <= len(password) <= 128:
        raise AkterraError("Password must be between 8 and 128 characters.")
    normalized_website = website.strip()
    if normalized_website:
        if len(normalized_website) > 300:
            raise AkterraError("Keep the company website URL under 300 characters.")
        if "://" not in normalized_website:
            normalized_website = f"https://{normalized_website}"
        parsed = urlparse(normalized_website)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise AkterraError("Enter a valid company website URL.")

    salt, password_hash = hash_password(password)
    company = {
        "role": "company",
        "email": normalized,
        "password_salt": salt,
        "password_hash": password_hash,
        "company_name": company_name.strip(),
        "contact_name": contact_name.strip(),
        "job_title": job_title.strip(),
        "industry": industry.strip(),
        "website": normalized_website,
        "work_details": work_details.strip(),
    }
    result = _execute(
        get_client()
        .table("users")
        .insert(company)
        .select("id,role,email,username")
    )
    if not result:
        raise DatabaseError("Company registration did not return a result.")
    return result[0]


def authenticate(identifier: str, password: str, role: str) -> dict[str, Any]:
    if role not in {"student", "college", "company"}:
        raise AkterraError("Invalid portal.")
    client = get_client()
    normalized = normalize_email(identifier)
    query = client.table("users").select("*").eq("role", role)
    if role == "company" and valid_email(normalized):
        query = query.eq("email", normalized)
    else:
        query = query.eq("username", str(identifier).strip().lower())
    user = _first(query)
    if (
        not user
        or len(password) > 128
        or not verify_password(password, user["password_salt"], user["password_hash"])
    ):
        raise AkterraError("Username or password is incorrect.")
    return user


def get_user(user_id: str, role: str) -> dict[str, Any] | None:
    return _first(
        get_client()
        .table("users")
        .select("id,role,email,username,college_id,company_name,contact_name,job_title,industry,website,work_details,created_at")
        .eq("id", user_id)
        .eq("role", role)
    )


def get_college(college_id: str) -> dict[str, Any]:
    college = _first(
        get_client()
        .table("colleges")
        .select("id,name,demo")
        .eq("id", college_id)
    )
    if not college:
        raise AkterraError("College workspace not found.")
    domains = _execute(
        get_client()
        .table("college_domains")
        .select("domain")
        .eq("college_id", college_id)
        .order("domain")
    )
    return {**college, "domains": [row["domain"] for row in domains]}


def get_students_for_college(college_id: str) -> list[dict[str, Any]]:
    domains = {
        row["domain"]
        for row in _execute(
            get_client()
            .table("college_domains")
            .select("domain")
            .eq("college_id", college_id)
        )
    }
    students = _execute(
        get_client()
        .table("users")
        .select("email,username,created_at")
        .eq("role", "student")
        .order("username")
    )
    return [
        {
            "email": student["email"],
            "username": student["username"],
            "created_at": student["created_at"],
        }
        for student in students
        if domain_from_email(student["email"]) in domains
    ]


def get_cohorts(college_id: str) -> list[dict[str, Any]]:
    cohorts = _execute(
        get_client()
        .table("cohorts")
        .select("graduation_year,eligible_student_count,updated_at")
        .eq("college_id", college_id)
        .order("graduation_year", desc=True)
    )
    placements = _execute(
        get_client()
        .table("placements")
        .select("graduation_year")
        .eq("college_id", college_id)
    )
    counts: dict[int, int] = {}
    for placement in placements:
        year = int(placement["graduation_year"])
        counts[year] = counts.get(year, 0) + 1
    return [{**row, "placed_count": counts.get(int(row["graduation_year"]), 0)} for row in cohorts]


def get_college_placements(college_id: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    client = get_client()
    placements = _execute(
        client.table("placements")
        .select("id,student_public_name,programme,graduation_year,company_name,role,created_at")
        .eq("college_id", college_id)
        .order("created_at", desc=True)
    )
    private_values = _execute(
        client.table("placements")
        .select("package_lpa")
        .eq("college_id", college_id)
    )
    count = len(private_values)
    average_is_private = count < 5
    average = (
        round(sum(float(row["package_lpa"]) for row in private_values) / count, 2)
        if count and not average_is_private
        else None
    )
    return placements, {
        "placement_count": count,
        "average_package_lpa": average,
        "package_average_suppressed": average_is_private,
    }


def get_public_leaderboard() -> list[dict[str, Any]]:
    client = get_client()
    colleges = _execute(
        client.table("colleges").select("id,name,demo").eq("demo", False)
    )
    cohorts = _execute(
        client.table("cohorts").select("college_id,graduation_year,eligible_student_count")
    )
    placements = _execute(
        client.table("placements").select("college_id,graduation_year,package_lpa")
    )
    return build_leaderboard(colleges, cohorts, placements)


def save_cohort_size(admin_id: str, graduation_year: int, eligible_count: int) -> None:
    _execute(
        get_client().rpc(
            "save_cohort_size",
            {
                "p_admin_id": admin_id,
                "p_graduation_year": graduation_year,
                "p_eligible_student_count": eligible_count,
            },
        )
    )


def add_placement(
    admin_id: str,
    student_public_name: str,
    programme: str,
    graduation_year: int,
    company_name: str,
    role: str,
    package_lpa: float,
) -> None:
    if len(student_public_name) > 100:
        raise AkterraError("Keep the public name under 100 characters.")
    for value, label in ((programme, "programme"), (company_name, "hiring company"), (role, "selected role")):
        if not 2 <= len(value.strip()) <= 120:
            raise AkterraError(f"Enter a {label} using 2 to 120 characters.")
    if not 2000 <= graduation_year <= 2100:
        raise AkterraError("Enter a valid graduation year.")
    if not 0 < package_lpa <= 1000:
        raise AkterraError("Enter a package between 0.01 and 1000 LPA.")
    _execute(
        get_client().rpc(
            "add_placement_record",
            {
                "p_admin_id": admin_id,
                "p_student_public_name": student_public_name,
                "p_programme": programme,
                "p_graduation_year": graduation_year,
                "p_company_name": company_name,
                "p_role": role,
                "p_package_lpa": round(package_lpa, 2),
            },
        )
    )


def delete_placement(admin_id: str, college_id: str, placement_id: str) -> None:
    if not get_user(admin_id, "college"):
        raise AkterraError("College admin session is no longer valid.")
    result = _execute(
        get_client()
        .table("placements")
        .delete()
        .eq("id", placement_id)
        .eq("college_id", college_id)
        .select("id")
    )
    if not result:
        raise AkterraError("Placement record not found.")


def add_college_domain(admin_id: str, email: str) -> None:
    normalized = normalize_email(email)
    if not valid_email(normalized):
        raise AkterraError("Enter a valid email at the domain you want to add.")
    _execute(
        get_client().rpc(
            "add_verified_college_domain",
            {
                "p_admin_id": admin_id,
                "p_email": normalized,
            },
        )
    )

