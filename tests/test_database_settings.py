import os
import unittest
from unittest.mock import patch

import database


class SettingsTests(unittest.TestCase):
    def test_non_empty_streamlit_secret_takes_precedence_over_environment(self):
        secret_url = "https://project.supabase.co"
        with patch.dict(os.environ, {"SUPABASE_URL": ""}):
            with patch.object(database.st, "secrets", {"SUPABASE_URL": secret_url}):
                self.assertEqual(database.setting("SUPABASE_URL"), secret_url)

    def test_environment_is_used_when_streamlit_secret_is_missing_or_empty(self):
        env_url = "https://environment.supabase.co"
        for secrets in ({}, {"SUPABASE_URL": "  "}):
            with self.subTest(secrets=secrets):
                with patch.dict(os.environ, {"SUPABASE_URL": env_url}):
                    with patch.object(database.st, "secrets", secrets):
                        self.assertEqual(database.setting("SUPABASE_URL"), env_url)


if __name__ == "__main__":
    unittest.main()
