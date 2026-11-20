from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import streamlit as st

import database as db
from akterra_core import domain_from_email, normalize_email, valid_email, valid_username


ROOT = Path(__file__).resolve().parent
LOGO = ROOT / "assets" / "akterra-logo.jpeg"
YEARS = list(range(2100, 1999, -1))
CURRENT_YEAR_INDEX = YEARS.index(datetime.now().year)

st.set_page_config(
    page_title="Akterra | Placement Universe",
    page_icon=str(LOGO),
    layout="wide",
    initial_sidebar_state="expanded",
)


def load_styles() -> None:
    st.markdown(
        """
        <style>
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        :root { color-scheme: dark; }
        html, body, [data-testid="stAppViewContainer"] {
            background: radial-gradient(ellipse at 83% 5%, rgba(132,16,39,.2), transparent 34%),
                        radial-gradient(ellipse at 14% 58%, rgba(75,16,29,.12), transparent 40%),
                        #09090b;
            color: #d7d4da;
            font-family: "DM Sans", sans-serif;
        }
        [data-testid="stHeader"] { background: rgba(8,8,10,.72); }
        [data-testid="stSidebar"] {
            background: linear-gradient(180deg, #121114 0%, #0a090b 100%);
            border-right: 1px solid rgba(192,188,195,.13);
        }
        [data-testid="stMainBlockContainer"] { max-width: 1180px; padding-top: 2rem; }
        h1, h2, h3 { color: #e0dce2; font-family: Cinzel, Georgia, serif; }
        h1 { letter-spacing: -.025em; }
        [data-testid="stMetric"] {
            background: rgba(18,16,19,.78); border: 1px solid rgba(192,188,195,.14);
            border-radius: 12px; padding: 1rem 1.1rem;
        }
        [data-testid="stMetricLabel"] { color: #aaa4ad; }
        [data-testid="stMetricValue"] { color: #f0e9ed; font-family: "IBM Plex Mono", monospace; }
        .akterra-eyebrow {
            color: #d34a60; font: 600 .73rem "IBM Plex Mono", monospace;
            letter-spacing: .16em; text-transform: uppercase;
        }
        .akterra-hero {
            padding: clamp(1.5rem, 5vw, 3.5rem); margin: .4rem 0 1.8rem;
            border: 1px solid rgba(194,42,64,.28); border-radius: 20px;
            background: linear-gradient(125deg, rgba(33,18,24,.92), rgba(15,14,17,.92) 58%, rgba(22,18,22,.86));
            box-shadow: inset 0 0 42px rgba(156,25,46,.05), 0 18px 56px rgba(0,0,0,.2);
        }
        .akterra-hero p { color: #b7b0b9; font-size: 1.05rem; line-height: 1.7; max-width: 760px; }
        .akterra-card {
            border: 1px solid rgba(192,188,195,.15); border-radius: 14px;
            padding: 1.1rem 1.25rem; background: rgba(16,15,18,.8); min-height: 130px;
        }
        .akterra-card h3 { font-size: 1.05rem; margin-top: 0; }
        .akterra-card p, .akterra-muted { color: #a7a1aa; }
        div.stButton > button, div[data-testid="stFormSubmitButton"] > button {
            border: 1px solid #a91d35; color: #f1e9eb;
            background: linear-gradient(135deg,#751528,#3e0b16);
            border-radius: 9px; transition: .18s ease;
        }
        div.stButton > button:hover, div[data-testid="stFormSubmitButton"] > button:hover {
            border-color: #ed5368; color: white; background: linear-gradient(135deg,#9d1b36,#57101d);
        }
        div[data-baseweb="input"] > div, div[data-baseweb="textarea"] > div,
        div[data-baseweb="select"] > div {
            background: rgba(10,9,12,.8); border-color: rgba(192,188,195,.2);
        }
        div[data-testid="stDataFrame"], [data-testid="stTable"] {
            border: 1px solid rgba(192,188,195,.15); border-radius: 10px; overflow: hidden;
        }
        hr { border-color: rgba(192,188,195,.14); }
        a { color: #e15a70 !important; }
        [data-testid="stCaptionContainer"] { color: #99939d; }
        @media (max-width: 700px) {
            [data-testid="stMainBlockContainer"] { padding: 1rem; }
            .akterra-hero { padding: 1.4rem; }
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def show_error(action: Any) -> bool:
    try:
        action()
        return True
    except db.AkterraError as error:
        st.error(str(error))
        return False


def sign_in(role: str, user: dict[str, Any]) -> None:
    st.session_state[f"auth_{role}"] = {
        "id": user["id"],
        "username": user.get("username") or user.get("email", ""),
    }


def current_user(role: str) -> dict[str, Any] | None:
    identity = st.session_state.get(f"auth_{role}")
    if not identity:
        return None
    user = db.get_user(identity["id"], role)
    if not user:
        del st.session_state[f"auth_{role}"]
        return None
    return user


def logout(role: str) -> None:
    st.session_state.pop(f"auth_{role}", None)
    for key in list(st.session_state.keys()):
        if key.startswith(f"{role}_"):
            del st.session_state[key]
    st.rerun()


def display_leaderboard(rows: list[dict[str, Any]]) -> None:
    display_rows = []
    for row in rows:
        count = int(row["placement_count"])
        if row["placement_rate_percent"] is None:
            rate = "Class size needed"
        else:
            rate = f'{row["placement_rate_percent"]:.1f}%'
        if row["package_average_suppressed"]:
            average = "Private until 5 rated placements" if count else "—"
        else:
            average = f'₹{row["average_package_lpa"]:.2f} LPA'
        score = "—" if row["score"] is None else f'{row["score"]:.1f}'
        if row["score_status"] == "provisional" and score != "—":
            score += "*"
        display_rows.append(
            {
                "Rank": row["rank"] if row["rank"] is not None else "—",
                "College": row["college_name"],
                "Placements in rated years": count,
                "Placement rate": rate,
                "Average package": average,
                "Rating / 100": score,
            }
        )
    if display_rows:
        st.dataframe(display_rows, hide_index=True, use_container_width=True)
    else:
        st.info("Rankings will appear as colleges report graduating class sizes and placements.")


def render_home() -> None:
    st.markdown(
        """
        <section class="akterra-hero">
          <div class="akterra-eyebrow">One universe · every placement journey</div>
          <h1>A better start to what’s next.</h1>
          <p>Akterra brings colleges, hiring companies, and students into one clearer, more connected placement experience.</p>
        </section>
        """,
        unsafe_allow_html=True,
    )
    columns = st.columns(3)
    cards = (
        ("College Admin", "Manage college domains, student lists, class sizes, and placement outcomes."),
        ("Company", "Create a company profile with official contact, industry, and hiring details."),
        ("Student", "Register with a verified college email and keep your Akterra account ready."),
    )
    for column, (heading, description) in zip(columns, cards):
        with column:
            st.markdown(
                f'<section class="akterra-card"><h3>{heading}</h3><p>{description}</p></section>',
                unsafe_allow_html=True,
            )
    st.markdown("### College leaderboard")
    st.caption(
        "Aggregate outcomes only. Class sizes, student details, and individual package values are never public."
    )
    try:
        display_leaderboard(db.get_public_leaderboard())
    except db.AkterraError as error:
        st.info(str(error))
    st.caption(
        "A provisional rating (*) uses the placement rate until five placements exist in rated years. "
        "See the scoring notes in the College Admin workspace."
    )


def render_login(role: str, label: str) -> None:
    identifier_label = "Company official email" if role == "company" else "Username"
    with st.form(f"{role}_login_form"):
        identifier = st.text_input(identifier_label, key=f"{role}_login_identifier")
        password = st.text_input(
            "Akterra password", type="password", key=f"{role}_login_password"
        )
        submitted = st.form_submit_button(f"Log in to {label}", use_container_width=True)
    if submitted:
        try:
            user = db.authenticate(identifier, password, role)
            sign_in(role, user)
            st.rerun()
        except db.AkterraError as error:
            st.error(str(error))


def request_registration_otp(role: str, email: str) -> None:
    normalized = normalize_email(email)
    if not valid_email(normalized):
        raise db.AkterraError("Enter a valid email address.")
    if role == "student":
        if not db.registered_college_for_email(normalized):
            raise db.AkterraError("Your college is not registered yet.")
    elif db.college_account_exists_for_domain(normalized):
        raise db.AkterraError("This college is already registered. Use the College Admin login.")
    if not db.email_available(normalized, role):
        raise db.ConflictError("An account already exists for this email. Log in instead.")
    db.send_email_otp(normalized, f"{role}_register")
    st.session_state[f"{role}_pending_email"] = normalized
    st.session_state.pop(f"{role}_verified_email", None)
    st.success("A verification code was sent. It expires in 5 minutes.")


def render_registration_verification(role: str) -> None:
    pending = st.session_state.get(f"{role}_pending_email")
    if not pending:
        return
    st.markdown("#### Verify your email")
    st.text(f"Enter the 6-digit code sent to {pending}.")
    with st.form(f"{role}_verify_form"):
        code = st.text_input(
            "Email verification code",
            max_chars=6,
            placeholder="000000",
            key=f"{role}_otp_code",
        )
        verify = st.form_submit_button("Verify code")
    if verify:
        try:
            db.verify_email_otp(pending, f"{role}_register", code.strip())
            st.session_state[f"{role}_verified_email"] = pending
            st.success("Email verified. You can finish creating your account.")
        except db.AkterraError as error:
            st.error(str(error))


def render_student_registration() -> None:
    st.markdown("#### Create a student account")
    with st.form("student_otp_request_form"):
        email = st.text_input(
            "College email",
            placeholder="you@yourcollege.edu",
            key="student_registration_email",
        )
        send = st.form_submit_button("Send email verification code")
    if send:
        show_error(lambda: request_registration_otp("student", email))

    render_registration_verification("student")
    verified = st.session_state.get("student_verified_email")
    if not verified:
        st.info("Verify a registered college email before creating an account.")
        return
    st.markdown("#### Account details")
    suggested_username = verified.split("@", 1)[0].lower()[:24]
    with st.form("student_registration_form"):
        st.text_input("Verified college email", value=verified, disabled=True)
        username = st.text_input("Unique username", value=suggested_username, max_chars=32)
        password = st.text_input("Create password", type="password", max_chars=128)
        confirm = st.text_input("Confirm password", type="password", max_chars=128)
        create = st.form_submit_button("Create student account", use_container_width=True)
    if create:
        try:
            if not valid_username(username):
                raise db.AkterraError(
                    "Username must be 3 to 32 characters and use letters, numbers, dots, underscores, or hyphens."
                )
            if password != confirm:
                raise db.AkterraError("The passwords do not match.")
            if not db.username_available(username, "student"):
                raise db.ConflictError("That username is already taken. Choose another one.")
            user = db.register_student(verified, username, password)
            sign_in("student", user)
            st.session_state.pop("student_verified_email", None)
            st.session_state.pop("student_pending_email", None)
            st.success("Your student account is ready.")
            st.rerun()
        except db.AkterraError as error:
            st.error(str(error))


def render_student_page() -> None:
    st.markdown('<div class="akterra-eyebrow">Student access</div>', unsafe_allow_html=True)
    st.title("Student portal")
    try:
        user = current_user("student")
    except db.AkterraError as error:
        st.error(str(error))
        return
    if user:
        left, right = st.columns([4, 1])
        with left:
            st.subheader(f"Welcome, {user['username']}")
            st.text(f"Verified account: {user['email']}")
            st.caption("Your student account is active.")
        with right:
            if st.button("Log out", key="student_logout"):
                logout("student")
        return
    mode = st.radio("Student account", ["Log in", "New registration"], horizontal=True)
    if mode == "Log in":
        render_login("student", "student portal")
    else:
        render_student_registration()


def render_college_registration() -> None:
    st.markdown("#### Register a college")
    with st.form("college_otp_request_form"):
        email = st.text_input(
            "Director or placement lead email",
            placeholder="name@college.edu",
            key="college_registration_email",
        )
        send = st.form_submit_button("Send email verification code")
    if send:
        show_error(lambda: request_registration_otp("college", email))
    render_registration_verification("college")

    verified = st.session_state.get("college_verified_email")
    if not verified:
        st.info("Verify an official college email before creating a workspace.")
        return
    suggested_username = verified.split("@", 1)[0].lower()[:24]
    with st.form("college_registration_form"):
        st.text_input("Verified official email", value=verified, disabled=True)
        college_name = st.text_input("College name", max_chars=120)
        username = st.text_input("Unique admin username", value=suggested_username, max_chars=32)
        password = st.text_input("Create password", type="password", max_chars=128)
        confirm = st.text_input("Confirm password", type="password", max_chars=128)
        create = st.form_submit_button("Create college workspace", use_container_width=True)
    if create:
        try:
            if password != confirm:
                raise db.AkterraError("The passwords do not match.")
            if not valid_username(username):
                raise db.AkterraError(
                    "Username must be 3 to 32 characters and use letters, numbers, dots, underscores, or hyphens."
                )
            if not db.username_available(username, "college"):
                raise db.ConflictError("That username is already taken. Choose another one.")
            user = db.register_college(verified, college_name, username, password)
            sign_in("college", user)
            st.session_state.pop("college_verified_email", None)
            st.session_state.pop("college_pending_email", None)
            st.success("Your college workspace is ready.")
            st.rerun()
        except db.AkterraError as error:
            st.error(str(error))


def render_students_tab(college_id: str) -> None:
    st.caption(
        "This college-only list includes email, username, and join date for students under "
        "your verified email domains. No other student details are exposed."
    )
    try:
        students = db.get_students_for_college(college_id)
        if students:
            st.dataframe(
                [
                    {
                        "College email ID": student["email"],
                        "Account username": student["username"],
                        "Joined": student["created_at"][:10],
                    }
                    for student in students
                ],
                hide_index=True,
                use_container_width=True,
            )
        else:
            st.info("No registered students found for this college yet.")
    except db.AkterraError as error:
        st.error(str(error))


def render_placements_tab(user: dict[str, Any]) -> None:
    college_id = user["college_id"]
    try:
        records, summary = db.get_college_placements(college_id)
        cohorts = db.get_cohorts(college_id)
        first, second = st.columns(2)
        first.metric("Successful placements", summary["placement_count"])
        average = (
            "Private until 5 placements"
            if summary["package_average_suppressed"]
            else f'₹{summary["average_package_lpa"]:.2f} LPA'
        )
        second.metric("Average package", average)
    except db.AkterraError as error:
        st.error(str(error))
        return

    st.markdown("#### Graduating class sizes")
    st.caption(
        "Class sizes remain private to this workspace and are required to calculate placement rates."
    )
    with st.form("cohort_size_form"):
        year = st.selectbox(
            "Graduation year", YEARS, index=CURRENT_YEAR_INDEX, key="cohort_year"
        )
        eligible = st.number_input(
            "Eligible graduating students", min_value=1, max_value=100000, step=1
        )
        save = st.form_submit_button("Save class size")
    if save:
        if show_error(lambda: db.save_cohort_size(user["id"], int(year), int(eligible))):
            st.success("Class size saved.")
            st.rerun()
    if cohorts:
        st.dataframe(
            [
                {
                    "Graduation year": row["graduation_year"],
                    "Eligible students": row["eligible_student_count"],
                    "Recorded placements": row["placed_count"],
                }
                for row in cohorts
            ],
            hide_index=True,
            use_container_width=True,
        )
    else:
        st.caption("No class sizes reported yet.")

    st.divider()
    st.markdown("#### Record a successful placement")
    st.caption(
        "Add one record per placed student. Package values are private and are never shown individually."
    )
    with st.form("placement_form"):
        name = st.text_input("Public name or initials (optional)", max_chars=100)
        programme = st.text_input("Programme or department", max_chars=120)
        placement_year = st.selectbox(
            "Placement graduation year",
            YEARS,
            index=CURRENT_YEAR_INDEX,
            key="placement_year",
        )
        company = st.text_input("Hiring company", max_chars=120)
        selected_role = st.text_input("Selected role", max_chars=120)
        package = st.number_input("Package (LPA)", min_value=0.01, max_value=1000.0, step=0.25)
        approved = st.checkbox(
            "This is one placed student, and the record contains no private contact details or student IDs."
        )
        add = st.form_submit_button("Save placement")
    if add:
        try:
            if not approved:
                raise db.AkterraError(
                    "Confirm that the placement contains no private contact details or student IDs."
                )
            db.add_placement(
                user["id"],
                name.strip(),
                programme,
                int(placement_year),
                company,
                selected_role,
                float(package),
            )
            st.success("Placement saved.")
            st.rerun()
        except db.AkterraError as error:
            st.error(str(error))

    st.divider()
    st.markdown("#### Your college records")
    st.caption("Non-contact placement details are visible only to your college admins.")
    if not records:
        st.info("No placement records yet.")
        return
    st.dataframe(
        [
            {
                "Public label": row["student_public_name"] or "Anonymous",
                "Programme": row["programme"],
                "Graduation year": row["graduation_year"],
                "Company": row["company_name"],
                "Role": row["role"],
                "Created": row["created_at"][:10],
            }
            for row in records
        ],
        hide_index=True,
        use_container_width=True,
    )
    labels = {
        row["id"]: (
            f'{row["student_public_name"] or "Anonymous"} · '
            f'{row["programme"]} · class of {row["graduation_year"]}'
        )
        for row in records
    }
    selected_id = st.selectbox(
        "Select a record to remove",
        options=list(labels),
        format_func=lambda record_id: labels[record_id],
        key="placement_delete_selection",
    )
    confirm_delete = st.checkbox(
        "I understand this permanently removes the selected placement record.",
        key="confirm_placement_delete",
    )
    if st.button("Delete selected placement", disabled=not confirm_delete):
        if show_error(lambda: db.delete_placement(user["id"], college_id, selected_id)):
            st.success("Placement removed.")
            st.rerun()


def render_leaderboard_tab() -> None:
    st.caption(
        "Only years with a reported class size count. Package averages are private until five placements "
        "in rated years; an asterisk marks a provisional rating."
    )
    try:
        display_leaderboard(db.get_public_leaderboard())
    except db.AkterraError as error:
        st.error(str(error))


def render_scoring_tab() -> None:
    st.markdown("#### How the leaderboard is calculated")
    st.write(
        "Each college reports the size of its graduating classes. Ratings include placements and "
        "class sizes only for years with a saved class size."
    )
    st.markdown("**Placement rate (75% of the final rating)**")
    st.code("placements in rated years / eligible graduates in rated years × 100")
    st.markdown("**Package attainment (25% of the final rating)**")
    st.code("min(average package / ₹20 LPA, 1) × 100")
    st.markdown("**Final rating**")
    st.code("0.75 × placement rate + 0.25 × package attainment")
    st.caption(
        "Before five placements in rated years, the package average and its contribution stay private; "
        "the provisional rating equals the placement rate. Colleges with no rated placements are not ranked. "
        "Ties are broken by placement rate, rated placements, average package, then college name."
    )
    st.info(
        "Public results never show class sizes, student names or emails, individual package values, "
        "or company-role placement rows."
    )


def render_domains_tab(user: dict[str, Any], college: dict[str, Any]) -> None:
    st.markdown("#### Registered email domains")
    if college["domains"]:
        st.code("\n".join(college["domains"]))
    else:
        st.info("No domains are registered yet.")
    st.caption("Each additional college domain must be verified by email.")
    pending_key = f"domain_pending_{user['id']}"
    verified_key = f"domain_verified_{user['id']}"
    with st.form("domain_otp_request_form"):
        email = st.text_input(
            "Email at the domain to add",
            placeholder="director@another-campus.edu",
            key="domain_request_email",
        )
        send = st.form_submit_button("Send domain verification code")
    if send:
        try:
            normalized = normalize_email(email)
            if not valid_email(normalized):
                raise db.AkterraError("Enter a valid email at the domain you want to add.")
            existing = db.college_for_domain(normalized)
            if existing:
                message = (
                    "That domain is already added to your college."
                    if existing == user["college_id"]
                    else "That domain is already registered with another college."
                )
                raise db.ConflictError(message)
            purpose = f"college_domain:{user['id']}"
            db.send_email_otp(normalized, purpose)
            st.session_state[pending_key] = normalized
            st.session_state.pop(verified_key, None)
            st.text(f"A verification code was sent to {normalized}.")
        except db.AkterraError as error:
            st.error(str(error))

    pending = st.session_state.get(pending_key)
    if pending:
        with st.form("domain_otp_verify_form"):
            st.text(f"Code sent to {pending}")
            code = st.text_input("6-digit verification code", max_chars=6)
            verify = st.form_submit_button("Verify domain email")
        if verify:
            try:
                db.verify_email_otp(pending, f"college_domain:{user['id']}", code.strip())
                st.session_state[verified_key] = pending
                st.success("Domain email verified.")
            except db.AkterraError as error:
                st.error(str(error))

    verified = st.session_state.get(verified_key)
    if verified:
        st.text(f"Verified address: {verified}")
        if st.button("Add verified domain", key="add_verified_domain"):
            try:
                db.add_college_domain(user["id"], verified)
                st.session_state.pop(pending_key, None)
                st.session_state.pop(verified_key, None)
                st.success("College domain added.")
                st.rerun()
            except db.AkterraError as error:
                st.error(str(error))


def render_college_workspace(user: dict[str, Any]) -> None:
    try:
        college = db.get_college(user["college_id"])
    except db.AkterraError as error:
        st.error(str(error))
        return
    left, right = st.columns([4, 1])
    with left:
        st.text(college["name"])
        st.caption(f'Signed in as {user["username"]}')
    with right:
        if st.button("Log out", key="college_logout"):
            logout("college")
    section = st.radio(
        "College workspace",
        ["Placements", "Students", "Leaderboard", "How it ranks", "Domains"],
        horizontal=True,
        label_visibility="collapsed",
        key="college_workspace_section",
    )
    if section == "Students":
        render_students_tab(college["id"])
    elif section == "Placements":
        render_placements_tab(user)
    elif section == "Leaderboard":
        render_leaderboard_tab()
    elif section == "How it ranks":
        render_scoring_tab()
    else:
        render_domains_tab(user, college)


def render_college_page() -> None:
    st.markdown('<div class="akterra-eyebrow">College access</div>', unsafe_allow_html=True)
    st.title("College Admin portal")
    try:
        user = current_user("college")
    except db.AkterraError as error:
        st.error(str(error))
        return
    if user:
        render_college_workspace(user)
        return
    mode = st.radio(
        "College account",
        ["Log in", "Register college"],
        horizontal=True,
        key="college_account_mode",
    )
    if mode == "Log in":
        render_login("college", "college workspace")
    else:
        render_college_registration()


def render_company_registration() -> None:
    st.markdown("#### Register your company")
    with st.form("company_registration_form"):
        company_name = st.text_input("Company name", max_chars=120)
        industry = st.text_input("Industry", max_chars=100)
        email = st.text_input("Company official email", placeholder="name@company.com")
        contact_name = st.text_input("Contact person", max_chars=100)
        job_title = st.text_input("Work title", max_chars=100)
        website = st.text_input("Company website (optional)", placeholder="https://company.com")
        work_details = st.text_area(
            "Work and hiring details",
            max_chars=2000,
            help="Describe what your company does, roles you hire for, and useful location or eligibility details.",
        )
        password = st.text_input("Create password", type="password", max_chars=128)
        confirm = st.text_input("Confirm password", type="password", max_chars=128)
        create = st.form_submit_button("Create company account", use_container_width=True)
    if create:
        try:
            if password != confirm:
                raise db.AkterraError("The passwords do not match.")
            user = db.register_company(
                email,
                password,
                company_name,
                contact_name,
                job_title,
                industry,
                website,
                work_details,
            )
            sign_in("company", user)
            st.success("Your company profile is ready.")
            st.rerun()
        except db.AkterraError as error:
            st.error(str(error))


def render_company_page() -> None:
    st.markdown('<div class="akterra-eyebrow">Company access</div>', unsafe_allow_html=True)
    st.title("Company portal")
    try:
        user = current_user("company")
    except db.AkterraError as error:
        st.error(str(error))
        return
    if user:
        left, right = st.columns([4, 1])
        with left:
            st.text(user["company_name"])
            st.text(f'{user["industry"]} · {user["email"]}')
        with right:
            if st.button("Log out", key="company_logout"):
                logout("company")
        st.markdown("#### Company profile")
        st.text(f'Contact: {user["contact_name"]} · {user["job_title"]}')
        if user["website"]:
            st.link_button("Company website", user["website"])
        st.text(user["work_details"])
        st.caption("To change profile details, contact the Akterra team.")
        return
    mode = st.radio(
        "Company account",
        ["Log in", "New registration"],
        horizontal=True,
        key="company_account_mode",
    )
    if mode == "Log in":
        render_login("company", "company portal")
    else:
        render_company_registration()


def main() -> None:
    load_styles()
    with st.sidebar:
        if LOGO.exists():
            st.image(str(LOGO), width=150)
        st.markdown("### AKTERRA")
        st.caption("PLACEMENT UNIVERSE")
        st.divider()
        page = st.radio(
            "Navigate",
            ["Overview", "Student portal", "College Admin", "Company portal"],
            label_visibility="collapsed",
        )
        st.divider()
        st.caption("A clearer path for every placement journey.")
    if page == "Overview":
        render_home()
    elif page == "Student portal":
        render_student_page()
    elif page == "College Admin":
        render_college_page()
    else:
        render_company_page()
    st.divider()
    st.caption("© 2026 Akterra · Founded by Anshuman Pratap Singh")


main()
