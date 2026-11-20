import unittest

from akterra_core import (
    build_leaderboard,
    domain_from_email,
    hash_otp,
    hash_password,
    normalize_email,
    otp_matches,
    valid_email,
    valid_username,
    verify_password,
)


class ValidationAndHashTests(unittest.TestCase):
    def test_normalizes_and_validates_email_and_username(self):
        self.assertEqual(normalize_email("  User@College.edu "), "user@college.edu")
        self.assertEqual(domain_from_email("User@College.edu"), "college.edu")
        self.assertTrue(valid_email("user@college.edu"))
        self.assertFalse(valid_email("not-an-email"))
        self.assertTrue(valid_username("student.name_2"))
        self.assertFalse(valid_username("x"))
        self.assertFalse(valid_username("not allowed"))

    def test_password_hash_verifies_without_storing_plaintext(self):
        salt, password_hash = hash_password("a-long-password")
        self.assertNotEqual(password_hash, "a-long-password")
        self.assertTrue(verify_password("a-long-password", salt, password_hash))
        self.assertFalse(verify_password("incorrect-password", salt, password_hash))

    def test_otp_hash_is_secret_bound_and_compared(self):
        stored = hash_otp("123456", "server-secret")
        self.assertTrue(otp_matches("123456", stored, "server-secret"))
        self.assertFalse(otp_matches("123457", stored, "server-secret"))
        self.assertFalse(otp_matches("123456", stored, "different-secret"))


class LeaderboardTests(unittest.TestCase):
    def test_scores_only_rated_years_and_suppresses_package_below_threshold(self):
        colleges = [
            {"id": "final", "name": "Final College", "demo": False},
            {"id": "provisional", "name": "Provisional College", "demo": False},
            {"id": "empty", "name": "Empty College", "demo": False},
            {"id": "demo", "name": "Demo College", "demo": True},
        ]
        cohorts = [
            {"college_id": "final", "graduation_year": 2026, "eligible_student_count": 10},
            {"college_id": "provisional", "graduation_year": 2026, "eligible_student_count": 4},
            {"college_id": "empty", "graduation_year": 2026, "eligible_student_count": 10},
        ]
        placements = [
            *[
                {
                    "college_id": "final",
                    "graduation_year": 2026,
                    "package_lpa": package,
                }
                for package in (6, 10, 14, 18, 22)
            ],
            {"college_id": "final", "graduation_year": 2025, "package_lpa": 99},
            *[
                {
                    "college_id": "provisional",
                    "graduation_year": 2026,
                    "package_lpa": 20,
                }
                for _ in range(2)
            ],
        ]

        rows = build_leaderboard(colleges, cohorts, placements)
        final = next(row for row in rows if row["college_id"] == "final")
        provisional = next(row for row in rows if row["college_id"] == "provisional")
        empty = next(row for row in rows if row["college_id"] == "empty")

        self.assertEqual(final["placement_count"], 5)
        self.assertEqual(final["average_package_lpa"], 14)
        self.assertEqual(final["placement_rate_percent"], 50)
        self.assertEqual(final["score"], 55)
        self.assertEqual(provisional["score_status"], "provisional")
        self.assertIsNone(provisional["average_package_lpa"])
        self.assertTrue(provisional["package_average_suppressed"])
        self.assertIsNone(empty["rank"])
        self.assertNotIn("eligible_student_count", final)
        self.assertNotIn("package_lpa", final)
        self.assertNotIn("demo", [row["college_id"] for row in rows])

    def test_college_without_a_reported_cohort_is_not_ranked(self):
        rows = build_leaderboard(
            [{"id": "new", "name": "New College", "demo": False}],
            [],
            [],
        )
        self.assertEqual(rows[0]["score_status"], "needs-cohort-size")
        self.assertIsNone(rows[0]["rank"])
        self.assertIsNone(rows[0]["placement_rate_percent"])

    def test_unrounded_rates_break_ties_before_display_rounding(self):
        colleges = [
            {"id": "lower", "name": "A College", "demo": False},
            {"id": "higher", "name": "Z College", "demo": False},
        ]
        cohorts = [
            {"college_id": "lower", "graduation_year": 2026, "eligible_student_count": 100000},
            {"college_id": "higher", "graduation_year": 2026, "eligible_student_count": 99999},
        ]
        placements = [
            {"college_id": college_id, "graduation_year": 2026, "package_lpa": 10}
            for college_id in ("lower", "higher")
            for _ in range(4)
        ]
        rows = build_leaderboard(colleges, cohorts, placements)
        self.assertEqual(rows[0]["college_id"], "higher")
        self.assertEqual(rows[0]["placement_rate_percent"], rows[1]["placement_rate_percent"])


if __name__ == "__main__":
    unittest.main()
