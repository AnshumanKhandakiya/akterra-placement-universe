# Akterra Placement Universe

Akterra is a multi-portal placement management app for students, college administrators, and hiring companies. The primary app is built with Streamlit and stores accounts and placement data in Supabase Postgres.

## Features

- Student registration with verified college email, unique usernames, secure password hashing, and sign-in.
- College registration and a private workspace for verified domains, domain-verified additions, student accounts, graduating class sizes, and placement records.
- Company registration, sign-in, and a company profile.
- A public aggregate leaderboard with the existing placement-rate/package scoring model. Class sizes, student details, and individual package values are never published; package averages are suppressed until five placements in rated years.
- OTP expiry, attempt limits, and resend limits.
- Supabase row-level security with access restricted to the server-side service role.

## Run locally

1. Install Python 3.12 or newer.
2. Create and activate a virtual environment.
3. Install dependencies:

   ```powershell
   python -m pip install -r requirements.txt
   ```

4. Create a Supabase project. In its SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql).
5. Copy `.streamlit/secrets.toml.example` to `.streamlit/secrets.toml`, then set the Supabase project URL, **server-only service-role key**, and a random `OTP_HMAC_SECRET`. Never commit `secrets.toml` or share these credentials.
6. To enable registration email verification, configure SMTP settings in `secrets.toml`. Gmail requires a Google app password. Without SMTP settings, account sign-in works, but OTP-dependent student and college registration and domain verification remain unavailable.
7. Start the app:

   ```powershell
   streamlit run streamlit_app.py
   ```

## Deploy with GitHub and Streamlit Community Cloud

1. Push this project to a GitHub repository. Keep the repository private if you do not want the source code public; Streamlit Community Cloud can deploy from a private repository when authorized.
2. In [Streamlit Community Cloud](https://share.streamlit.io/), choose **Create app**, select the repository and branch, and set the app file to `streamlit_app.py`.
3. In the app's **Advanced settings → Secrets**, add the values from `.streamlit/secrets.toml.example`. Use the Supabase **service-role** key only in Streamlit's server-side secrets; never put it in source code or a browser-facing setting.
4. Deploy, then confirm the overview loads and test registration with an email account you control.

The Supabase database and SMTP sender must be configured by the account owner. Keep a private backup of the Supabase database and rotate any credential that is accidentally exposed. Streamlit Community Cloud is suitable for a project/demo; review its current limits and use a production hosting/database plan before storing sensitive personal data at scale.

## Database and migration notes

Run `supabase/schema.sql` once per Supabase project. It creates the tables, indexes, RLS policies, transactional registration/placement functions, and a demo college placeholder (with no email domains). Student and college registration require an administrator to register the college domain first. Company accounts do not require OTP.

The original Node app and its local JSON data format are retained for reference and local use; they are not the deployed Streamlit backend. Existing accounts in ignored `data/` files are **not** migrated to Supabase. Do not copy production credentials or personal data into GitHub. Contact the project owner before attempting any account/data migration.

## Project files

- `streamlit_app.py` — Streamlit interface for the public page and all three portals.
- `database.py` — Supabase access, account workflows, OTP delivery, and data scoping.
- `akterra_core.py` — password/OTP helpers, input validation, and leaderboard calculations.
- `supabase/schema.sql` — database schema, row-level security, and atomic database functions.
- `requirements.txt` — Python dependencies used by Streamlit Community Cloud.
- `assets/akterra-logo.jpeg` — Akterra logo.
- `server.js`, `index.html`, and the CSS/JavaScript files — retained Node implementation.

## Tests

Run the database-independent checks with:

```powershell
python -m unittest discover -s tests -v
```
