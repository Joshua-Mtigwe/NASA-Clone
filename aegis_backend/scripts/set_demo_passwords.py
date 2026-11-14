"""Give demo users real hashed passwords (the seed CSV has none, so nobody can log in until this runs).

    python scripts/set_demo_passwords.py                  # every user still on the placeholder
    python scripts/set_demo_passwords.py --user crew1     # one user; you type the password

Generated passwords are written to demo_credentials.local.txt (listed in .gitignore).
Never commit that file. Re-running skips users who already have a password unless you pass --user.
"""
import argparse
import getpass
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.config import get_settings  # noqa: E402
from app.core.security import is_real_password_hash  # noqa: E402
from app.database.session import connect  # noqa: E402
from app.services.auth_service import set_user_password  # noqa: E402

CREDENTIALS_FILE = ROOT / "demo_credentials.local.txt"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", default=str(get_settings().database_path))
    parser.add_argument("--user", help="username to set; prompts for the password")
    args = parser.parse_args()

    conn = connect(args.db)
    try:
        if args.user:
            row = conn.execute("SELECT user_id FROM users WHERE username = ?", (args.user,)).fetchone()
            if row is None:
                print(f"No user named {args.user}")
                return 1
            password = getpass.getpass(f"New password for {args.user} (8+ characters): ")
            if password != getpass.getpass("Repeat: "):
                print("Passwords do not match")
                return 1
            set_user_password(conn, row["user_id"], password)
            print(f"Password set for {args.user}")
            return 0

        users = conn.execute("SELECT user_id, username, password_hash FROM users ORDER BY user_id").fetchall()
        pending = [u for u in users if not is_real_password_hash(u["password_hash"])]
        if not pending:
            print("Every user already has a password. Use --user NAME to change one.")
            return 0
        lines = []
        for u in pending:
            password = secrets.token_urlsafe(12)
            set_user_password(conn, u["user_id"], password)
            lines.append(f"{u['username']}\t{password}")
        with CREDENTIALS_FILE.open("a", encoding="utf-8") as fh:
            fh.write("# username<TAB>password (local demo only; do not commit)\n" + "\n".join(lines) + "\n")
        print(f"Set passwords for {len(pending)} users. They are in {CREDENTIALS_FILE.name}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
