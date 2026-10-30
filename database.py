import os
import logging
import aiosqlite
from typing import List, Dict, Optional, Any

DB_PATH = os.getenv("DB_PATH", "bot_tracker.db")
logger = logging.getLogger(__name__)


async def init_db(primary_admin_id: int) -> None:
    """Initialize SQLite database tables and seed primary admin."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON;")

        # 1. Users table (for broadcast & tracking)
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                username TEXT,
                full_name TEXT,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        # 2. Bots table
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS bots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bot_name TEXT NOT NULL,
                bot_username TEXT NOT NULL,
                per_refer_amount REAL NOT NULL,
                min_withdraw REAL NOT NULL,
                work_type TEXT NOT NULL,
                force_channels_count INTEGER NOT NULL DEFAULT 1,
                proof_status TEXT NOT NULL DEFAULT 'Verified Paying',
                description TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        # 3. Force Channels table
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS force_channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_name TEXT NOT NULL,
                channel_username_or_id TEXT NOT NULL UNIQUE,
                invite_link TEXT NOT NULL
            )
            """
        )

        # 4. Admins table
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS admins (
                user_id INTEGER PRIMARY KEY
            )
            """
        )

        # 5. Submissions table
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                user_name TEXT NOT NULL,
                bot_id INTEGER NOT NULL,
                screenshot_file_id TEXT NOT NULL,
                user_note TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (bot_id) REFERENCES bots (id) ON DELETE CASCADE
            )
            """
        )

        # Ensure primary_admin_id from ADMIN_ID env is registered
        if primary_admin_id:
            await db.execute(
                "INSERT OR IGNORE INTO admins (user_id) VALUES (?)",
                (primary_admin_id,),
            )

        await db.commit()
    logger.info("Database initialized successfully at %s", DB_PATH)


# =====================================================================
# USER & ADMIN QUERIES
# =====================================================================

async def register_user(user_id: int, username: Optional[str], full_name: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO users (user_id, username, full_name)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                username = excluded.username,
                full_name = excluded.full_name
            """,
            (user_id, username or "", full_name),
        )
        await db.commit()


async def get_all_user_ids() -> List[int]:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT user_id FROM users") as cursor:
            rows = await cursor.fetchall()
            return [row[0] for row in rows]


async def is_admin(user_id: int, primary_admin_id: int) -> bool:
    if user_id == primary_admin_id:
        return True
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT 1 FROM admins WHERE user_id = ?", (user_id,)
        ) as cursor:
            row = await cursor.fetchone()
            return row is not None


async def get_all_admins(primary_admin_id: int) -> List[int]:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT user_id FROM admins") as cursor:
            rows = await cursor.fetchall()
            admin_ids = {row[0] for row in rows}
            if primary_admin_id:
                admin_ids.add(primary_admin_id)
            return sorted(list(admin_ids))


async def add_admin(user_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO admins (user_id) VALUES (?)", (user_id,)
        )
        await db.commit()
        return True


# =====================================================================
# BOTS CRUD QUERIES
# =====================================================================

async def add_bot(
    bot_name: str,
    bot_username: str,
    per_refer_amount: float,
    min_withdraw: float,
    work_type: str,
    force_channels_count: int,
    proof_status: str = "Verified Paying",
    description: str = "",
) -> int:
    clean_username = bot_username.lstrip("@").strip()
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO bots (
                bot_name, bot_username, per_refer_amount, min_withdraw,
                work_type, force_channels_count, proof_status, description
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                bot_name.strip(),
                clean_username,
                per_refer_amount,
                min_withdraw,
                work_type.strip(),
                force_channels_count,
                proof_status.strip(),
                description.strip(),
            ),
        )
        await db.commit()
        return cursor.lastrowid


async def get_bots(offset: int = 0, limit: int = 5) -> List[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM bots ORDER BY id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def get_all_bots() -> List[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM bots ORDER BY id DESC") as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def count_bots() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COUNT(*) FROM bots") as cursor:
            row = await cursor.fetchone()
            return row[0] if row else 0


async def get_bot_by_id(bot_id: int) -> Optional[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM bots WHERE id = ?", (bot_id,)) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def delete_bot(bot_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("DELETE FROM bots WHERE id = ?", (bot_id,))
        await db.commit()
        return cursor.rowcount > 0


# =====================================================================
# FORCE CHANNELS QUERIES
# =====================================================================

async def add_force_channel(
    channel_name: str, channel_username_or_id: str, invite_link: str
) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT OR REPLACE INTO force_channels (
                channel_name, channel_username_or_id, invite_link
            )
            VALUES (?, ?, ?)
            """,
            (channel_name.strip(), channel_username_or_id.strip(), invite_link.strip()),
        )
        await db.commit()
        return cursor.lastrowid


async def get_force_channels() -> List[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM force_channels ORDER BY id ASC") as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def delete_force_channel(channel_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "DELETE FROM force_channels WHERE id = ?", (channel_id,)
        )
        await db.commit()
        return cursor.rowcount > 0


# =====================================================================
# SUBMISSIONS QUERIES
# =====================================================================

async def create_submission(
    user_id: int,
    user_name: str,
    bot_id: int,
    screenshot_file_id: str,
    user_note: str = "",
) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO submissions (
                user_id, user_name, bot_id, screenshot_file_id, user_note, status
            )
            VALUES (?, ?, ?, ?, ?, 'pending')
            """,
            (user_id, user_name, bot_id, screenshot_file_id, user_note.strip()),
        )
        await db.commit()
        return cursor.lastrowid


async def get_user_submissions(user_id: int) -> List[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT s.*, b.bot_name, b.bot_username, b.per_refer_amount
            FROM submissions s
            LEFT JOIN bots b ON s.bot_id = b.id
            WHERE s.user_id = ?
            ORDER BY s.id DESC
            LIMIT 20
            """,
            (user_id,),
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def get_pending_submissions() -> List[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT s.*, b.bot_name, b.bot_username, b.per_refer_amount, b.min_withdraw
            FROM submissions s
            LEFT JOIN bots b ON s.bot_id = b.id
            WHERE s.status = 'pending'
            ORDER BY s.id ASC
            """
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def get_submission_by_id(submission_id: int) -> Optional[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT s.*, b.bot_name, b.bot_username, b.per_refer_amount
            FROM submissions s
            LEFT JOIN bots b ON s.bot_id = b.id
            WHERE s.id = ?
            """,
            (submission_id,),
        ) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def update_submission_status(submission_id: int, status: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "UPDATE submissions SET status = ? WHERE id = ?",
            (status, submission_id),
        )
        await db.commit()
        return cursor.rowcount > 0
