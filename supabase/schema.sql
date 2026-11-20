create extension if not exists pgcrypto;

create table if not exists public.colleges (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(trim(name)) between 3 and 120),
    demo boolean not null default false,
    created_at timestamptz not null default now()
);

create table if not exists public.college_domains (
    domain text primary key check (domain = lower(trim(domain))),
    college_id uuid not null references public.colleges(id) on delete cascade,
    created_at timestamptz not null default now()
);

create table if not exists public.users (
    id uuid primary key default gen_random_uuid(),
    role text not null check (role in ('student', 'college', 'company')),
    college_id uuid references public.colleges(id) on delete cascade,
    email text not null check (email = lower(trim(email))),
    username text,
    password_salt text not null,
    password_hash text not null,
    company_name text,
    contact_name text,
    job_title text,
    industry text,
    website text,
    work_details text,
    created_at timestamptz not null default now(),
    check ((role = 'college') = (college_id is not null)),
    check ((role = 'company') = (company_name is not null)),
    check ((role = 'company') = (contact_name is not null)),
    check ((role = 'company') = (job_title is not null)),
    check ((role = 'company') = (industry is not null)),
    check ((role = 'company') = (work_details is not null))
);

create unique index if not exists users_role_email_unique
    on public.users (role, lower(email));
create unique index if not exists users_role_username_unique
    on public.users (role, lower(username))
    where username is not null;
create index if not exists users_college_id_index
    on public.users (college_id)
    where role = 'student';

create table if not exists public.cohorts (
    id uuid primary key default gen_random_uuid(),
    college_id uuid not null references public.colleges(id) on delete cascade,
    graduation_year integer not null check (graduation_year between 2000 and 2100),
    eligible_student_count integer not null check (eligible_student_count between 1 and 100000),
    updated_at timestamptz not null default now(),
    unique (college_id, graduation_year)
);

create table if not exists public.placements (
    id uuid primary key default gen_random_uuid(),
    college_id uuid not null references public.colleges(id) on delete cascade,
    student_public_name text not null default '' check (char_length(student_public_name) <= 100),
    programme text not null check (char_length(trim(programme)) between 2 and 120),
    graduation_year integer not null check (graduation_year between 2000 and 2100),
    company_name text not null check (char_length(trim(company_name)) between 2 and 120),
    role text not null check (char_length(trim(role)) between 2 and 120),
    package_lpa numeric(8, 2) not null check (package_lpa > 0 and package_lpa <= 1000),
    created_at timestamptz not null default now()
);
create index if not exists placements_college_year_index
    on public.placements (college_id, graduation_year);

create table if not exists public.email_otps (
    purpose text not null,
    email text not null check (email = lower(trim(email))),
    code_hash text not null,
    sent_at timestamptz not null,
    expires_at timestamptz not null,
    attempts integer not null default 0 check (attempts between 0 and 5),
    verified_at timestamptz,
    rate_window_started_at timestamptz not null,
    sent_in_window integer not null default 1 check (sent_in_window between 1 and 3),
    primary key (purpose, email)
);

insert into public.colleges (id, name, demo)
values ('c7e2aa87-02cf-4bb5-83da-5cbff7a343c4', 'Akterra Demo College', true)
on conflict (id) do nothing;

create or replace function public.reserve_email_otp(
    p_purpose text,
    p_email text,
    p_code_hash text
) returns table (status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_email text := lower(trim(p_email));
    current_record public.email_otps%rowtype;
    window_start timestamptz;
    next_count integer;
begin
    perform pg_advisory_xact_lock(hashtextextended(p_purpose || ':' || normalized_email, 0));
    select * into current_record
    from public.email_otps
    where purpose = p_purpose and email = normalized_email
    for update;
    if found then
        if now() - current_record.sent_at < interval '1 minute' then
            return query select 'too_soon'::text;
            return;
        end if;
        if now() - current_record.rate_window_started_at < interval '1 hour' then
            if current_record.sent_in_window >= 3 then
                return query select 'hour_limit'::text;
                return;
            end if;
            window_start := current_record.rate_window_started_at;
            next_count := current_record.sent_in_window + 1;
        else
            window_start := now();
            next_count := 1;
        end if;
        update public.email_otps
        set code_hash = p_code_hash,
            sent_at = now(),
            expires_at = now() + interval '5 minutes',
            attempts = 0,
            verified_at = null,
            rate_window_started_at = window_start,
            sent_in_window = next_count
        where purpose = p_purpose and email = normalized_email;
    else
        insert into public.email_otps (
            purpose, email, code_hash, sent_at, expires_at,
            attempts, verified_at, rate_window_started_at, sent_in_window
        )
        values (
            p_purpose, normalized_email, p_code_hash, now(), now() + interval '5 minutes',
            0, null, now(), 1
        );
    end if;
    return query select 'reserved'::text;
end;
$$;

create or replace function public.verify_email_otp(
    p_purpose text,
    p_email text,
    p_code_hash text
) returns table (status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_email text := lower(trim(p_email));
    otp public.email_otps%rowtype;
begin
    select * into otp
    from public.email_otps
    where purpose = p_purpose and email = normalized_email
    for update;
    if not found or otp.expires_at <= now() then
        return query select 'expired'::text;
        return;
    end if;
    if otp.attempts >= 5 then
        return query select 'locked'::text;
        return;
    end if;
    if otp.code_hash <> p_code_hash then
        update public.email_otps
        set attempts = attempts + 1
        where purpose = p_purpose and email = normalized_email;
        if otp.attempts + 1 >= 5 then
            return query select 'locked'::text;
        else
            return query select 'incorrect'::text;
        end if;
        return;
    end if;
    update public.email_otps
    set verified_at = now()
    where purpose = p_purpose and email = normalized_email;
    return query select 'verified'::text;
end;
$$;

alter table public.colleges enable row level security;
alter table public.college_domains enable row level security;
alter table public.users enable row level security;
alter table public.cohorts enable row level security;
alter table public.placements enable row level security;
alter table public.email_otps enable row level security;

revoke all on public.colleges, public.college_domains, public.users, public.cohorts,
    public.placements, public.email_otps from public, anon, authenticated;
grant all on public.colleges, public.college_domains, public.users, public.cohorts,
    public.placements, public.email_otps to service_role;

create or replace function public.register_student_account(
    p_email text,
    p_username text,
    p_password_salt text,
    p_password_hash text
) returns table (id uuid, username text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_email text := lower(trim(p_email));
    otp public.email_otps%rowtype;
    new_user public.users%rowtype;
begin
    select * into otp
    from public.email_otps
    where purpose = 'student_register' and email = normalized_email
    for update;
    if not found or otp.verified_at is null or otp.expires_at <= now()
       or otp.attempts >= 5 then
        raise exception 'Verify your college email with a new OTP before registering.';
    end if;
    if not exists (
        select 1 from public.college_domains
        where domain = split_part(normalized_email, '@', 2)
    ) then
        raise exception 'Your college is not registered yet.';
    end if;
    insert into public.users (role, email, username, password_salt, password_hash)
    values ('student', normalized_email, lower(trim(p_username)), p_password_salt, p_password_hash)
    returning * into new_user;
    delete from public.email_otps
    where purpose = 'student_register' and email = normalized_email;
    return query select new_user.id, new_user.username;
end;
$$;

create or replace function public.register_college_account(
    p_email text,
    p_college_name text,
    p_username text,
    p_password_salt text,
    p_password_hash text
) returns table (id uuid, username text, college_id uuid, college_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_email text := lower(trim(p_email));
    domain_name text := split_part(lower(trim(p_email)), '@', 2);
    otp public.email_otps%rowtype;
    target_college_id uuid;
    target_college_name text;
    new_user public.users%rowtype;
begin
    select * into otp
    from public.email_otps
    where purpose = 'college_register' and email = normalized_email
    for update;
    if not found or otp.verified_at is null or otp.expires_at <= now()
       or otp.attempts >= 5 then
        raise exception 'Verify your official college email with a new OTP before registering.';
    end if;
    select c.id, c.name into target_college_id, target_college_name
    from public.college_domains d
    join public.colleges c on c.id = d.college_id
    where d.domain = domain_name
    for update of c;
    if target_college_id is not null and exists (
        select 1 from public.users
        where role = 'college' and college_id = target_college_id
    ) then
        raise exception 'This college is already registered. Use the College Admin login.';
    end if;
    if target_college_id is null then
        target_college_name := trim(p_college_name);
        insert into public.colleges (name) values (target_college_name)
        returning id into target_college_id;
        insert into public.college_domains (domain, college_id)
        values (domain_name, target_college_id);
    else
        target_college_name := trim(p_college_name);
        update public.colleges
        set name = target_college_name, demo = false
        where id = target_college_id;
    end if;
    insert into public.users (
        role, college_id, email, username, password_salt, password_hash
    )
    values (
        'college', target_college_id, normalized_email, lower(trim(p_username)),
        p_password_salt, p_password_hash
    )
    returning * into new_user;
    delete from public.email_otps
    where purpose = 'college_register' and email = normalized_email;
    return query select new_user.id, new_user.username, target_college_id, target_college_name;
end;
$$;

create or replace function public.add_verified_college_domain(
    p_admin_id uuid,
    p_email text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_email text := lower(trim(p_email));
    domain_name text := split_part(lower(trim(p_email)), '@', 2);
    admin_college_id uuid;
    otp public.email_otps%rowtype;
begin
    select college_id into admin_college_id
    from public.users where id = p_admin_id and role = 'college';
    if admin_college_id is null then
        raise exception 'College admin session is no longer valid.';
    end if;
    select * into otp
    from public.email_otps
    where purpose = 'college_domain:' || p_admin_id::text and email = normalized_email
    for update;
    if not found or otp.verified_at is null or otp.expires_at <= now()
       or otp.attempts >= 5 then
        raise exception 'Verify this email with a new OTP before adding its domain.';
    end if;
    insert into public.college_domains (domain, college_id)
    values (domain_name, admin_college_id);
    delete from public.email_otps
    where purpose = 'college_domain:' || p_admin_id::text and email = normalized_email;
    return domain_name;
end;
$$;

create or replace function public.save_cohort_size(
    p_admin_id uuid,
    p_graduation_year integer,
    p_eligible_student_count integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    target_college_id uuid;
    placed_count integer;
begin
    select college_id into target_college_id
    from public.users where id = p_admin_id and role = 'college';
    if target_college_id is null then
        raise exception 'College admin session is no longer valid.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(target_college_id::text || ':' || p_graduation_year::text, 0));
    select count(*) into placed_count
    from public.placements
    where college_id = target_college_id and graduation_year = p_graduation_year;
    if p_eligible_student_count < placed_count then
        raise exception 'Class size cannot be lower than its % recorded placements.', placed_count;
    end if;
    insert into public.cohorts (college_id, graduation_year, eligible_student_count, updated_at)
    values (target_college_id, p_graduation_year, p_eligible_student_count, now())
    on conflict (college_id, graduation_year)
    do update set eligible_student_count = excluded.eligible_student_count, updated_at = now();
end;
$$;

create or replace function public.add_placement_record(
    p_admin_id uuid,
    p_student_public_name text,
    p_programme text,
    p_graduation_year integer,
    p_company_name text,
    p_role text,
    p_package_lpa numeric
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    target_college_id uuid;
    eligible_count integer;
    placed_count integer;
    new_id uuid;
begin
    select college_id into target_college_id
    from public.users where id = p_admin_id and role = 'college';
    if target_college_id is null then
        raise exception 'College admin session is no longer valid.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(target_college_id::text || ':' || p_graduation_year::text, 0));
    select eligible_student_count into eligible_count
    from public.cohorts
    where college_id = target_college_id and graduation_year = p_graduation_year;
    if found then
        select count(*) into placed_count
        from public.placements
        where college_id = target_college_id and graduation_year = p_graduation_year;
        if placed_count >= eligible_count then
            raise exception 'This class already has as many placement records as its reported class size.';
        end if;
    end if;
    insert into public.placements (
        college_id, student_public_name, programme, graduation_year, company_name, role, package_lpa
    )
    values (
        target_college_id, trim(coalesce(p_student_public_name, '')), trim(p_programme),
        p_graduation_year, trim(p_company_name), trim(p_role), p_package_lpa
    )
    returning id into new_id;
    return new_id;
end;
$$;

revoke all on function public.register_student_account(text, text, text, text) from public, anon, authenticated;
revoke all on function public.register_college_account(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.add_verified_college_domain(uuid, text) from public, anon, authenticated;
revoke all on function public.save_cohort_size(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.add_placement_record(uuid, text, text, integer, text, text, numeric) from public, anon, authenticated;
revoke all on function public.reserve_email_otp(text, text, text) from public, anon, authenticated;
revoke all on function public.verify_email_otp(text, text, text) from public, anon, authenticated;

grant execute on function public.register_student_account(text, text, text, text) to service_role;
grant execute on function public.register_college_account(text, text, text, text, text) to service_role;
grant execute on function public.add_verified_college_domain(uuid, text) to service_role;
grant execute on function public.save_cohort_size(uuid, integer, integer) to service_role;
grant execute on function public.add_placement_record(uuid, text, text, integer, text, text, numeric) to service_role;
grant execute on function public.reserve_email_otp(text, text, text) to service_role;
grant execute on function public.verify_email_otp(text, text, text) to service_role;
