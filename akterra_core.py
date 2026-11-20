"""Pure validation, password, OTP, and leaderboard helpers for Akterra."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

MIN_PLACEMENTS_FOR_PACKAGE_AVERAGE = 5
PACKAGE_TARGET_LPA = 20.0
PLACEMENT_RATE_WEIGHT = 0.75
PACKAGE_ATTAINMENT_WEIGHT = 0.25

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
USERNAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$", re.IGNORECASE)


def _fixed(value: float, places: int) -> float:
    quantum = Decimal(1).scaleb(-places)
    return float(Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_UP))


def normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def valid_email(value: Any) -> bool:
    return bool(EMAIL_PATTERN.fullmatch(normalize_email(value)))


def domain_from_email(value: Any) -> str:
    return normalize_email(value).rsplit("@", 1)[-1]


def valid_username(value: Any) -> bool:
    return bool(USERNAME_PATTERN.fullmatch(str(value or "").strip()))


def hash_password(password: str) -> tuple[str, str]:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64)
    return salt.hex(), derived.hex()


def verify_password(password: str, salt_hex: str, expected_hex: str) -> bool:
    try:
        expected = bytes.fromhex(expected_hex)
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=2**14,
            r=8,
            p=1,
            dklen=len(expected),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def hash_otp(code: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), code.encode("utf-8"), hashlib.sha256).hexdigest()


def otp_matches(code: str, expected_hash: str, secret: str) -> bool:
    return hmac.compare_digest(hash_otp(code, secret), str(expected_hash or ""))


def build_leaderboard(
    colleges: list[dict[str, Any]],
    cohorts: list[dict[str, Any]],
    placements: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return public-safe aggregate rows; class sizes and individual packages stay private."""
    rated_years: dict[str, set[int]] = defaultdict(set)
    eligible_counts: dict[str, int] = defaultdict(int)
    for cohort in cohorts:
        college_id = str(cohort["college_id"])
        year = int(cohort["graduation_year"])
        rated_years[college_id].add(year)
        eligible_counts[college_id] += int(cohort["eligible_student_count"])

    rated_placements: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for placement in placements:
        college_id = str(placement["college_id"])
        if int(placement["graduation_year"]) in rated_years[college_id]:
            rated_placements[college_id].append(placement)

    rows = []
    for college in colleges:
        if college.get("demo"):
            continue
        college_id = str(college["id"])
        records = rated_placements[college_id]
        count = len(records)
        eligible = eligible_counts[college_id]
        rate = min(count / eligible, 1.0) * 100 if eligible else None
        suppressed = count < MIN_PLACEMENTS_FOR_PACKAGE_AVERAGE
        average = (
            sum(float(record["package_lpa"]) for record in records) / count
            if count and not suppressed
            else None
        )
        attainment = min(average / PACKAGE_TARGET_LPA, 1.0) * 100 if average is not None else None
        provisional = rate is not None and suppressed
        score = (
            None
            if rate is None
            else rate
            if provisional
            else PLACEMENT_RATE_WEIGHT * rate + PACKAGE_ATTAINMENT_WEIGHT * float(attainment)
        )
        rows.append(
            {
                "college_id": college_id,
                "college_name": str(college["name"]),
                "placement_count": count,
                "placement_rate_percent": None if rate is None else _fixed(rate, 1),
                "average_package_lpa": None if average is None else _fixed(average, 2),
                "package_average_suppressed": suppressed,
                "score": None if score is None else _fixed(score, 1),
                "score_status": (
                    "needs-cohort-size"
                    if rate is None
                    else "provisional"
                    if provisional
                    else "final"
                ),
                "rankable": count > 0 and rate is not None,
                "_sort_score": score,
                "_sort_rate": rate,
                "_sort_average": average,
            }
        )

    rows.sort(
        key=lambda row: (
            not row["rankable"],
            -(row["_sort_score"] if row["_sort_score"] is not None else -1),
            -(row["_sort_rate"] if row["_sort_rate"] is not None else -1),
            -row["placement_count"],
            -(row["_sort_average"] or 0),
            row["college_name"].casefold(),
        )
    )
    rank = 0
    for row in rows:
        row["rank"] = rank + 1 if row["rankable"] else None
        if row["rankable"]:
            rank += 1
        del row["rankable"]
        del row["_sort_score"]
        del row["_sort_rate"]
        del row["_sort_average"]
    return rows
