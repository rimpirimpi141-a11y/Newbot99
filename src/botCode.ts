export interface ProjectFile {
  name: string;
  language: string;
  description: string;
  lines: number;
  content: string;
}

export const BOT_PROJECT_FILES: ProjectFile[] = [
  {
    name: 'main.py',
    language: 'python',
    description: 'Entrypoint: Starts aiohttp GET / health check server on PORT (8080) for Render + Aiogram 3.x polling.',
    lines: 78,
    content: `import os
import sys
import asyncio
import logging
from aiohttp import web
from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

import database as db
from handlers import router

# Configure structured logging for Render logs
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("refer_bot_tracker")


async def health_check_handler(request: web.Request) -> web.Response:
    """Render Web Service health check endpoint (GET / -> 200 OK)."""
    return web.json_response(
        {
            "status": "ok",
            "service": "telegram-refer-earn-bot-tracker",
            "health": "healthy",
        },
        status=200,
    )


async def start_background_http_server() -> web.AppRunner:
    """Starts lightweight aiohttp server on PORT (default 8080) for Render."""
    port = int(os.getenv("PORT", "8080"))
    app = web.Application()
    app.router.add_get("/", health_check_handler)
    app.router.add_get("/health", health_check_handler)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="0.0.0.0", port=port)
    await site.start()
    logger.info("Render HTTP health server listening on http://0.0.0.0:%d", port)
    return runner


async def main() -> None:
    # Strictly require ONLY BOT_TOKEN and ADMIN_ID
    bot_token = os.getenv("BOT_TOKEN", "").strip()
    admin_id_raw = os.getenv("ADMIN_ID", "").strip()

    if not bot_token:
        logger.error("CRITICAL: Environment variable BOT_TOKEN is not set!")
        sys.exit(1)

    if not admin_id_raw or not admin_id_raw.isdigit():
        logger.error("CRITICAL: Environment variable ADMIN_ID must be a valid integer Telegram User ID!")
        sys.exit(1)

    primary_admin_id = int(admin_id_raw)

    # 1. Initialize SQLite database & seed primary admin
    await db.init_db(primary_admin_id=primary_admin_id)

    # 2. Start Render Web Service background HTTP health server
    http_runner = await start_background_http_server()

    # 3. Initialize Aiogram 3.x Bot & Dispatcher
    bot = Bot(
        token=bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dp = Dispatcher(storage=MemoryStorage())
    dp.include_router(router)

    logger.info("Starting Telegram Bot polling (Primary ADMIN_ID=%d)...", primary_admin_id)
    try:
        await bot.delete_webhook(drop_pending_updates=True)
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        await http_runner.cleanup()
        await bot.session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Bot stopped gracefully.")`
  },
  {
    name: 'database.py',
    language: 'python',
    description: 'Asynchronous aiosqlite schema & CRUD layer for bots, force_channels, admins, users, and submissions.',
    lines: 279,
    content: `import os
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
        return cursor.rowcount > 0`
  },
  {
    name: 'keyboards.py',
    language: 'python',
    description: 'Colourful InlineKeyboardMarkup builders with 🟢/🔵/🔴/🟡 visual themes and direct URL actions.',
    lines: 238,
    content: `from typing import List, Dict, Any
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.utils.keyboard import InlineKeyboardBuilder

SUPPORT_URL = "https://t.me/aaditya334356"


def force_join_kb(channels: List[Dict[str, Any]]) -> InlineKeyboardMarkup:
    """Colourful Force-Join verification keyboard with direct channel URLs."""
    builder = InlineKeyboardBuilder()
    for idx, ch in enumerate(channels, start=1):
        builder.row(
            InlineKeyboardButton(
                text=f"🔵 Join {ch['channel_name']} (#{idx})",
                url=ch["invite_link"],
            )
        )
    builder.row(
        InlineKeyboardButton(
            text="🟢 Verify / Check Join",
            callback_data="verify_force_join",
        )
    )
    return builder.as_markup()


def main_menu_kb(is_user_admin: bool = False) -> InlineKeyboardMarkup:
    """Colourful Main Menu Inline Keyboard for verified users."""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(
            text="🟢 Browse Refer Bots", callback_data="browse_bots:0"
        )
    )
    builder.row(
        InlineKeyboardButton(
            text="🔵 Submit Earning Proof", callback_data="submit_proof_menu"
        ),
        InlineKeyboardButton(
            text="📊 My Submissions", callback_data="my_submissions"
        ),
    )
    builder.row(
        InlineKeyboardButton(
            text="💬 Support & Contact", url=SUPPORT_URL
        )
    )
    if is_user_admin:
        builder.row(
            InlineKeyboardButton(
                text="🛠️ Open Admin Control Panel", callback_data="admin_panel"
            )
        )
    return builder.as_markup()


def bots_directory_kb(
    bots: List[Dict[str, Any]], offset: int, total: int, page_size: int = 5
) -> InlineKeyboardMarkup:
    """Paginated directory of tracked Refer & Earn bots."""
    builder = InlineKeyboardBuilder()
    for bot in bots:
        builder.row(
            InlineKeyboardButton(
                text=f"🟢 {bot['bot_name']} — ₹{bot['per_refer_amount']:g}/Refer",
                callback_data=f"bot_detail:{bot['id']}:{offset}",
            )
        )

    nav_buttons = []
    if offset > 0:
        prev_offset = max(0, offset - page_size)
        nav_buttons.append(
            InlineKeyboardButton(
                text="⬅️ Prev Page", callback_data=f"browse_bots:{prev_offset}"
            )
        )
    if offset + page_size < total:
        next_offset = offset + page_size
        nav_buttons.append(
            InlineKeyboardButton(
                text="Next Page ➡️", callback_data=f"browse_bots:{next_offset}"
            )
        )
    if nav_buttons:
        builder.row(*nav_buttons)

    builder.row(
        InlineKeyboardButton(
            text="🏠 Back to Main Menu", callback_data="back_main_menu"
        )
    )
    return builder.as_markup()


def bot_detail_kb(bot: Dict[str, Any], return_offset: int = 0) -> InlineKeyboardMarkup:
    """Bot detail view with Direct Bot Launch URL and Proof Submission trigger."""
    builder = InlineKeyboardBuilder()
    clean_username = bot["bot_username"].lstrip("@")
    builder.row(
        InlineKeyboardButton(
            text=f"🟢 Launch @{clean_username} Now",
            url=f"https://t.me/{clean_username}",
        )
    )
    builder.row(
        InlineKeyboardButton(
            text="🔵 Submit Earning Proof for This Bot",
            callback_data=f"select_proof_bot:{bot['id']}",
        )
    )
    builder.row(
        InlineKeyboardButton(
            text="⬅️ Back to Bot List",
            callback_data=f"browse_bots:{return_offset}",
        ),
        InlineKeyboardButton(
            text="🏠 Main Menu",
            callback_data="back_main_menu",
        ),
    )
    return builder.as_markup()


def select_bot_for_proof_kb(bots: List[Dict[str, Any]]) -> InlineKeyboardMarkup:
    """Selection keyboard for choosing which bot to submit payout proof for."""
    builder = InlineKeyboardBuilder()
    for bot in bots:
        builder.row(
            InlineKeyboardButton(
                text=f"🔵 {bot['bot_name']} (₹{bot['per_refer_amount']:g}/ref)",
                callback_data=f"select_proof_bot:{bot['id']}",
            )
        )
    builder.row(
        InlineKeyboardButton(
            text="🔴 Cancel & Return", callback_data="back_main_menu"
        )
    )
    return builder.as_markup()


def cancel_fsm_kb(cancel_callback: str = "cancel_fsm") -> InlineKeyboardMarkup:
    """Standard red cancel button for active FSM states."""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(
            text="🔴 Cancel Operation", callback_data=cancel_callback
        )
    )
    return builder.as_markup()


def back_to_main_kb() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(
            text="🏠 Back to Main Menu", callback_data="back_main_menu"
        )
    )
    return builder.as_markup()


# =====================================================================
# ADMIN PANEL KEYBOARDS
# =====================================================================

def admin_panel_kb(pending_count: int = 0) -> InlineKeyboardMarkup:
    """Categorized colourful Admin Panel keyboard."""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(
            text="🟢 Add New Refer Bot", callback_data="admin_add_bot"
        ),
        InlineKeyboardButton(
            text="🔴 Delete / Manage Bots", callback_data="admin_manage_bots"
        ),
    )
    builder.row(
        InlineKeyboardButton(
            text="🔵 Add Force Channel", callback_data="admin_add_channel"
        ),
        InlineKeyboardButton(
            text="🔴 Remove Force Channel", callback_data="admin_remove_channel"
        ),
    )
    badge = f" ({pending_count})" if pending_count > 0 else ""
    builder.row(
        InlineKeyboardButton(
            text=f"🟡 Review Submissions{badge}",
            callback_data="admin_review_submissions",
        )
    )
    builder.row(
        InlineKeyboardButton(
            text="👥 Add New Admin", callback_data="admin_add_admin"
        ),
        InlineKeyboardButton(
            text="📢 Broadcast Message", callback_data="admin_broadcast"
        ),
    )
    builder.row(
        InlineKeyboardButton(
            text="🏠 Exit to User Main Menu", callback_data="back_main_menu"
        )
    )
    return builder.as_markup()


def admin_delete_bots_kb(bots: List[Dict[str, Any]]) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for bot in bots:
        builder.row(
            InlineKeyboardButton(
                text=f"🔴 Delete {bot['bot_name']} (@{bot['bot_username']})",
                callback_data=f"admin_del_bot:{bot['id']}",
            )
        )
    builder.row(
        InlineKeyboardButton(
            text="⬅️ Back to Admin Panel", callback_data="admin_panel"
        )
    )
    return builder.as_markup()


def admin_remove_channels_kb(channels: List[Dict[str, Any]]) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for ch in channels:
        builder.row(
            InlineKeyboardButton(
                text=f"🔴 Remove {ch['channel_name']} ({ch['channel_username_or_id']})",
                callback_data=f"admin_del_channel:{ch['id']}",
            )
        )
    builder.row(
        InlineKeyboardButton(
            text="⬅️ Back to Admin Panel", callback_data="admin_panel"
        )
    )
    return builder.as_markup()


def submission_review_action_kb(submission_id: int) -> InlineKeyboardMarkup:
    """One-tap Approve / Reject keyboard for admin submission review."""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(
            text="🟢 Approve Submission",
            callback_data=f"admin_sub_decision:approve:{submission_id}",
        ),
        InlineKeyboardButton(
            text="🔴 Reject Submission",
            callback_data=f"admin_sub_decision:reject:{submission_id}",
        ),
    )
    builder.row(
        InlineKeyboardButton(
            text="⏭️ Skip / Next Pending",
            callback_data="admin_review_submissions",
        ),
        InlineKeyboardButton(
            text="⬅️ Admin Panel",
            callback_data="admin_panel",
        ),
    )
    return builder.as_markup()`
  },
  {
    name: 'handlers.py',
    language: 'python',
    description: 'Aiogram 3.x routers, Force-Join subscription verifier, User Proof FSM, and Admin Panel FSM flows.',
    lines: 615,
    content: `import os
import logging
from typing import List, Dict, Any

from aiogram import Router, Bot, F
from aiogram.filters import CommandStart, Command
from aiogram.types import Message, CallbackQuery
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError

import database as db
import keyboards as kb

logger = logging.getLogger(__name__)
router = Router()

PRIMARY_ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))
PAGE_SIZE = 5


# =====================================================================
# FINITE STATE MACHINES (FSM)
# =====================================================================

class ProofSubmissionFSM(StatesGroup):
    waiting_for_details = State()
    waiting_for_screenshot = State()


class AddBotFSM(StatesGroup):
    waiting_for_name = State()
    waiting_for_username = State()
    waiting_for_per_refer = State()
    waiting_for_work_type = State()
    waiting_for_force_count = State()
    waiting_for_min_withdraw = State()
    waiting_for_description = State()


class AddForceChannelFSM(StatesGroup):
    waiting_for_name = State()
    waiting_for_id_or_username = State()
    waiting_for_invite_link = State()


class AddAdminFSM(StatesGroup):
    waiting_for_user_id = State()


class BroadcastFSM(StatesGroup):
    waiting_for_message = State()


# =====================================================================
# HELPER: CHECK FORCE-JOIN SUBSCRIPTION
# =====================================================================

async def check_user_subscriptions(bot: Bot, user_id: int) -> List[Dict[str, Any]]:
    """
    Returns a list of channels from \`force_channels\` that the user has NOT joined yet.
    Admins bypass force-join automatically.
    """
    if await db.is_admin(user_id, PRIMARY_ADMIN_ID):
        return []

    channels = await db.get_force_channels()
    unjoined = []

    for ch in channels:
        chat_id = ch["channel_username_or_id"]
        try:
            member = await bot.get_chat_member(chat_id=chat_id, user_id=user_id)
            if member.status in ("left", "kicked"):
                unjoined.append(ch)
        except Exception as exc:
            logger.warning(
                "Could not verify membership for channel %s (user %s): %s",
                chat_id,
                user_id,
                exc,
            )
            continue

    return unjoined


async def send_main_menu(
    target: Message | CallbackQuery, user_id: int, full_name: str, edit: bool = False
) -> None:
    is_adm = await db.is_admin(user_id, PRIMARY_ADMIN_ID)
    total_bots = await db.count_bots()
    text = (
        f"🌟 <b>Welcome to Refer & Earn Tracker, {full_name}!</b>\\n\\n"
        f"🟢 <b>Active Verified Bots:</b> <code>{total_bots}</code>\\n"
        f"🔵 Track the highest-paying Refer & Earn bots, verify instant withdrawal limits, "
        f"and submit your earning proofs directly for fast approval.\\n\\n"
        f"👇 <b>Choose an option below to get started:</b>"
    )
    markup = kb.main_menu_kb(is_user_admin=is_adm)

    if isinstance(target, CallbackQuery):
        if edit and target.message:
            try:
                await target.message.edit_text(text, reply_markup=markup, parse_mode="HTML")
                return
            except TelegramBadRequest:
                pass
        if target.message:
            await target.message.answer(text, reply_markup=markup, parse_mode="HTML")
    else:
        await target.answer(text, reply_markup=markup, parse_mode="HTML")


# =====================================================================
# USER HANDLERS (/start & Force-Join Gate)
# =====================================================================

@router.message(CommandStart())
async def cmd_start(message: Message, bot: Bot, state: FSMContext) -> None:
    await state.clear()
    user = message.from_user
    if not user:
        return

    await db.register_user(user.id, user.username, user.full_name)

    unjoined = await check_user_subscriptions(bot, user.id)
    if unjoined:
        await message.answer(
            "🔒 <b>Mandatory Channel Verification Required</b>\\n\\n"
            "To access verified Refer & Earn bots and submit payout proofs, "
            "please join all official channels listed below first:\\n\\n"
            "After joining, tap <b>🟢 Verify / Check Join</b>.",
            reply_markup=kb.force_join_kb(unjoined),
            parse_mode="HTML",
        )
        return

    await send_main_menu(message, user.id, user.full_name, edit=False)


@router.callback_query(F.data == "verify_force_join")
async def cb_verify_force_join(callback: CallbackQuery, bot: Bot) -> None:
    user = callback.from_user
    unjoined = await check_user_subscriptions(bot, user.id)
    if unjoined:
        await callback.answer(
            "🔴 You have not joined all required channels yet! Please join them first.",
            show_alert=True,
        )
        if callback.message:
            try:
                await callback.message.edit_reply_markup(
                    reply_markup=kb.force_join_kb(unjoined)
                )
            except TelegramBadRequest:
                pass
        return

    await callback.answer("🟢 Verification successful! Welcome aboard.")
    await send_main_menu(callback, user.id, user.full_name, edit=True)


@router.callback_query(F.data == "back_main_menu")
async def cb_back_main_menu(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.answer()
    await send_main_menu(
        callback, callback.from_user.id, callback.from_user.full_name, edit=True
    )


@router.callback_query(F.data == "cancel_fsm")
async def cb_cancel_fsm(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.answer("🔴 Action cancelled.")
    await send_main_menu(
        callback, callback.from_user.id, callback.from_user.full_name, edit=True
    )


# =====================================================================
# REFER BOT DIRECTORY & BOT DETAILS
# =====================================================================

@router.callback_query(F.data.startswith("browse_bots:"))
async def cb_browse_bots(callback: CallbackQuery, bot: Bot) -> None:
    unjoined = await check_user_subscriptions(bot, callback.from_user.id)
    if unjoined:
        await callback.answer("🔴 Please join our mandatory channels first!", show_alert=True)
        if callback.message:
            await callback.message.edit_text(
                "🔒 <b>Please join all required channels to continue:</b>",
                reply_markup=kb.force_join_kb(unjoined),
                parse_mode="HTML",
            )
        return

    offset = int(callback.data.split(":")[1])
    total = await db.count_bots()
    bots = await db.get_bots(offset=offset, limit=PAGE_SIZE)

    if total == 0:
        await callback.answer()
        if callback.message:
            await callback.message.edit_text(
                "📭 <b>No Refer & Earn Bots Listed Yet</b>\\n\\n"
                "Our admins are currently verifying new high-paying refer bots. Check back soon!",
                reply_markup=kb.back_to_main_kb(),
                parse_mode="HTML",
            )
        return

    current_page = (offset // PAGE_SIZE) + 1
    total_pages = (total + PAGE_SIZE - 1) // PAGE_SIZE
    text = (
        f"🟢 <b>Verified Refer & Earn Bots Directory</b>\\n"
        f"📄 Page <code>{current_page}/{total_pages}</code> • Total Tracked: <code>{total}</code>\\n\\n"
        f"Select any bot below to view its per-refer payout, task requirements, "
        f"minimum withdrawal threshold, and direct launch link:"
    )
    await callback.answer()
    if callback.message:
        await callback.message.edit_text(
            text,
            reply_markup=kb.bots_directory_kb(bots, offset, total, PAGE_SIZE),
            parse_mode="HTML",
        )


@router.callback_query(F.data.startswith("bot_detail:"))
async def cb_bot_detail(callback: CallbackQuery) -> None:
    parts = callback.data.split(":")
    bot_id = int(parts[1])
    return_offset = int(parts[2]) if len(parts) > 2 else 0

    bot_info = await db.get_bot_by_id(bot_id)
    if not bot_info:
        await callback.answer("🔴 Bot no longer exists.", show_alert=True)
        return

    text = (
        f"🤖 <b>{bot_info['bot_name']}</b> (@{bot_info['bot_username']})\\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\\n"
        f"🟢 <b>Reward per Refer:</b> ₹{bot_info['per_refer_amount']:g}\\n"
        f"🏦 <b>Minimum Withdrawal:</b> ₹{bot_info['min_withdraw']:g}\\n"
        f"⚙️ <b>Work / Task Required:</b> {bot_info['work_type']}\\n"
        f"📢 <b>Force Channels in Bot:</b> {bot_info['force_channels_count']} channel(s)\\n"
        f"✅ <b>Payout Status:</b> {bot_info['proof_status']}\\n"
    )
    if bot_info.get("description"):
        text += f"\\n📝 <b>Notes:</b> {bot_info['description']}\\n"

    text += (
        "\\n💡 <i>Click the green button below to launch the bot, complete your referrals, "
        "and then submit your screenshot proof here!</i>"
    )

    await callback.answer()
    if callback.message:
        await callback.message.edit_text(
            text,
            reply_markup=kb.bot_detail_kb(bot_info, return_offset),
            parse_mode="HTML",
        )


# =====================================================================
# PROOF SUBMISSION FLOW (USER FSM)
# =====================================================================

@router.callback_query(F.data == "submit_proof_menu")
async def cb_submit_proof_menu(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    bots = await db.get_all_bots()
    if not bots:
        await callback.answer("🔴 No bots available for proof submission yet.", show_alert=True)
        return

    await callback.answer()
    if callback.message:
        await callback.message.edit_text(
            "🔵 <b>Submit Earning / Withdrawal Proof</b>\\n\\n"
            "Select the Refer & Earn bot you completed referrals or withdrawal for:",
            reply_markup=kb.select_bot_for_proof_kb(bots),
            parse_mode="HTML",
        )


@router.callback_query(F.data.startswith("select_proof_bot:"))
async def cb_select_proof_bot(callback: CallbackQuery, state: FSMContext) -> None:
    bot_id = int(callback.data.split(":")[1])
    bot_info = await db.get_bot_by_id(bot_id)
    if not bot_info:
        await callback.answer("🔴 Selected bot was not found.", show_alert=True)
        return

    await state.update_data(
        bot_id=bot_id,
        bot_name=bot_info["bot_name"],
        per_refer_amount=bot_info["per_refer_amount"],
    )
    await state.set_state(ProofSubmissionFSM.waiting_for_details)
    await callback.answer()

    if callback.message:
        await callback.message.edit_text(
            f"🔵 <b>Submitting Proof for: {bot_info['bot_name']}</b>\\n"
            f"💰 <b>Rate:</b> ₹{bot_info['per_refer_amount']:g} / refer\\n\\n"
            f"✍️ <b>Step 1 of 2:</b> Please type your referral count, UPI/Wallet details, "
            f"or claim note (e.g. <i>Completed 10 referrals, UPI: user@upi</i>):",
            reply_markup=kb.cancel_fsm_kb(),
            parse_mode="HTML",
        )


@router.message(ProofSubmissionFSM.waiting_for_details, F.text)
async def fsm_proof_details(message: Message, state: FSMContext) -> None:
    note = message.text.strip()
    if len(note) < 3:
        await message.answer(
            "🔴 Please provide valid details (at least 3 characters).",
            reply_markup=kb.cancel_fsm_kb(),
        )
        return

    await state.update_data(user_note=note)
    await state.set_state(ProofSubmissionFSM.waiting_for_screenshot)
    await message.answer(
        "📸 <b>Step 2 of 2: Upload Screenshot Proof</b>\\n\\n"
        "Please send the <b>photo/screenshot</b> showing your referral balance or payout proof:",
        reply_markup=kb.cancel_fsm_kb(),
        parse_mode="HTML",
    )


@router.message(ProofSubmissionFSM.waiting_for_screenshot, F.photo)
async def fsm_proof_screenshot(message: Message, state: FSMContext, bot: Bot) -> None:
    data = await state.get_data()
    await state.clear()

    photo = message.photo[-1]
    user = message.from_user
    user_display = f"@{user.username}" if user.username else user.full_name

    submission_id = await db.create_submission(
        user_id=user.id,
        user_name=user_display,
        bot_id=data["bot_id"],
        screenshot_file_id=photo.file_id,
        user_note=data.get("user_note", ""),
    )

    await message.answer(
        f"🟢 <b>Proof Submitted Successfully! (ID: #{submission_id})</b>\\n\\n"
        f"🤖 <b>Bot:</b> {data['bot_name']}\\n"
        f"📝 <b>Details:</b> {data.get('user_note', 'N/A')}\\n"
        f"⏳ <b>Status:</b> Pending Admin Review\\n\\n"
        f"You will receive an instant notification as soon as an admin reviews your proof.",
        reply_markup=kb.back_to_main_kb(),
        parse_mode="HTML",
    )

    admin_ids = await db.get_all_admins(PRIMARY_ADMIN_ID)
    admin_caption = (
        f"🔔 <b>New Earning Proof Submitted! (#{submission_id})</b>\\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\\n"
        f"👤 <b>User:</b> {user_display} (<code>{user.id}</code>)\\n"
        f"🤖 <b>Bot:</b> {data['bot_name']}\\n"
        f"💸 <b>Per Refer Rate:</b> ₹{data['per_refer_amount']:g}\\n"
        f"📝 <b>Claim Details:</b> {data.get('user_note', 'N/A')}\\n"
    )
    for admin_id in admin_ids:
        try:
            await bot.send_photo(
                chat_id=admin_id,
                photo=photo.file_id,
                caption=admin_caption,
                reply_markup=kb.submission_review_action_kb(submission_id),
                parse_mode="HTML",
            )
        except Exception as exc:
            logger.warning("Failed to notify admin %s: %s", admin_id, exc)


@router.message(ProofSubmissionFSM.waiting_for_screenshot)
async def fsm_proof_screenshot_invalid(message: Message) -> None:
    await message.answer(
        "🔴 Please upload a valid <b>Photo / Screenshot</b> (not just text) to complete your submission.",
        reply_markup=kb.cancel_fsm_kb(),
        parse_mode="HTML",
    )


# =====================================================================
# MY SUBMISSIONS HISTORY
# =====================================================================

@router.callback_query(F.data == "my_submissions")
async def cb_my_submissions(callback: CallbackQuery) -> None:
    subs = await db.get_user_submissions(callback.from_user.id)
    await callback.answer()

    if not subs:
        if callback.message:
            await callback.message.edit_text(
                "📊 <b>My Submissions</b>\\n\\n"
                "You haven't submitted any earning proofs yet. "
                "Tap <b>🔵 Submit Earning Proof</b> from the main menu once you complete a task!",
                reply_markup=kb.back_to_main_kb(),
                parse_mode="HTML",
            )
        return

    status_icons = {
        "pending": "🟡 Pending",
        "approved": "🟢 Approved",
        "rejected": "🔴 Rejected",
    }

    lines = ["📊 <b>Your Recent Earning Proof Submissions:</b>\\n"]
    for s in subs:
        badge = status_icons.get(s["status"], s["status"])
        bot_title = s.get("bot_name") or f"Bot #{s['bot_id']}"
        lines.append(
            f"• <b>#{s['id']}</b> — <b>{bot_title}</b>: {badge}\\n"
            f"  <i>Note: {s.get('user_note') or 'No note'}</i>"
        )

    if callback.message:
        await callback.message.edit_text(
            "\\n".join(lines),
            reply_markup=kb.back_to_main_kb(),
            parse_mode="HTML",
        )


# =====================================================================
# ADMIN PANEL (/admin) & ACCESS GUARD
# =====================================================================

async def render_admin_home(target: Message | CallbackQuery, edit: bool = False) -> None:
    pending = await db.get_pending_submissions()
    bots_count = await db.count_bots()
    channels = await db.get_force_channels()
    admins = await db.get_all_admins(PRIMARY_ADMIN_ID)
    users = await db.get_all_user_ids()

    text = (
        "🛠️ <b>Admin Control Center</b>\\n"
        "━━━━━━━━━━━━━━━━━━━━━━\\n"
        f"🟢 <b>Tracked Refer Bots:</b> <code>{bots_count}</code>\\n"
        f"🔵 <b>Active Force Channels:</b> <code>{len(channels)}</code>\\n"
        f"🟡 <b>Pending Proofs to Review:</b> <code>{len(pending)}</code>\\n"
        f"👥 <b>Authorized Admins:</b> <code>{len(admins)}</code>\\n"
        f"📊 <b>Total Registered Users:</b> <code>{len(users)}</code>\\n\\n"
        "Select an administrative action below:"
    )
    markup = kb.admin_panel_kb(pending_count=len(pending))

    if isinstance(target, CallbackQuery):
        if edit and target.message:
            try:
                await target.message.edit_text(text, reply_markup=markup, parse_mode="HTML")
                return
            except TelegramBadRequest:
                pass
        if target.message:
            await target.message.answer(text, reply_markup=markup, parse_mode="HTML")
    else:
        await target.answer(text, reply_markup=markup, parse_mode="HTML")


@router.message(Command("admin"))
async def cmd_admin(message: Message, state: FSMContext) -> None:
    await state.clear()
    if not message.from_user or not await db.is_admin(message.from_user.id, PRIMARY_ADMIN_ID):
        await message.answer("🔴 <b>Access Denied:</b> You are not authorized to view the Admin Panel.", parse_mode="HTML")
        return

    await render_admin_home(message, edit=False)


@router.callback_query(F.data == "admin_panel")
async def cb_admin_panel(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    if not await db.is_admin(callback.from_user.id, PRIMARY_ADMIN_ID):
        await callback.answer("🔴 Unauthorized access.", show_alert=True)
        return

    await callback.answer()
    await render_admin_home(callback, edit=True)


# =====================================================================
# ADMIN: ADD NEW REFER BOT (MULTI-STEP FSM)
# =====================================================================

@router.callback_query(F.data == "admin_add_bot")
async def cb_admin_add_bot(callback: CallbackQuery, state: FSMContext) -> None:
    if not await db.is_admin(callback.from_user.id, PRIMARY_ADMIN_ID):
        await callback.answer("🔴 Unauthorized.", show_alert=True)
        return

    await state.set_state(AddBotFSM.waiting_for_name)
    await callback.answer()
    if callback.message:
        await callback.message.edit_text(
            "🟢 <b>Add New Refer Bot (Step 1/7)</b>\\n\\n"
            "Enter the display <b>Name</b> of the Refer & Earn Bot (e.g. <i>CashKing Refer Bot</i>):",
            reply_markup=kb.cancel_fsm_kb("admin_panel"),
            parse_mode="HTML",
        )


@router.message(AddBotFSM.waiting_for_name, F.text)
async def fsm_bot_name(message: Message, state: FSMContext) -> None:
    await state.update_data(bot_name=message.text.strip())
    await state.set_state(AddBotFSM.waiting_for_username)
    await message.answer(
        "🟢 <b>Step 2/7 — Bot Username:</b>\\n"
        "Enter the Telegram username of the bot (e.g. <code>@CashKingReferBot</code>):",
        reply_markup=kb.cancel_fsm_kb("admin_panel"),
        parse_mode="HTML",
    )


@router.message(AddBotFSM.waiting_for_username, F.text)
async def fsm_bot_username(message: Message, state: FSMContext) -> None:
    username = message.text.strip().lstrip("@")
    if " " in username or len(username) < 3:
        await message.answer("🔴 Invalid username. Please enter a valid bot username without spaces.")
        return

    await state.update_data(bot_username=username)
    await state.set_state(AddBotFSM.waiting_for_per_refer)
    await message.answer(
        "🟢 <b>Step 3/7 — Per Refer Payout (₹):</b>\\n"
        "Enter the numeric reward per referral in INR (e.g. <code>5</code> or <code>12.5</code>):",
        reply_markup=kb.cancel_fsm_kb("admin_panel"),
        parse_mode="HTML",
    )


@router.message(AddBotFSM.waiting_for_per_refer, F.text)
async def fsm_bot_per_refer(message: Message, state: FSMContext) -> None:
    try:
        amount = float(message.text.strip().replace("₹", ""))
        if amount <= 0:
            raise ValueError
    except ValueError:
        await message.answer("🔴 Please enter a valid positive number for Per Refer Pay (e.g. <code>5</code>).", parse_mode="HTML")
        return

    await state.update_data(per_refer_amount=amount)
    await state.set_state(AddBotFSM.waiting_for_work_type)
    await message.answer(
        "🟢 <b>Step 4/7 — Task / Work Type:</b>\\n"
        "Describe the task required (e.g. <i>Join Channels & Verify Captcha</i> or <i>Instant Auto-Approve</i>):",
        reply_markup=kb.cancel_fsm_kb("admin_panel"),
        parse_mode="HTML",
    )


@router.message(AddBotFSM.waiting_for_work_type, F.text)
async def fsm_bot_work_type(message: Message, state: FSMContext) -> None:
    await state.update_data(work_type=message.text.strip())
    await state.set_state(AddBotFSM.waiting_for_force_count)
    await message.answer(
        "🟢 <b>Step 5/7 — Force Channels Count:</b>\\n"
        "How many force-join channels does this bot require users to join? (Enter an integer like <code>3</code>):",
        reply_markup=kb.cancel_fsm_kb("admin_panel"),
        parse_mode="HTML",
    )


@router.message(AddBotFSM.waiting_for_force_count, F.text)
async def fsm_bot_force_count(message: Message, state: FSMContext) -> None:
    try:
        count = int(message.text.strip())
        if count < 0:
            raise ValueError
    except ValueError:
        await message.answer("🔴 Please enter a valid non-negative integer (e.g. <code>3</code>).", parse_mode="HTML")
        return

    await state.update_data(force_channels_count=count)
    await state.set_state(AddBotFSM.waiting_for_min_withdraw)
    await message.answer(
        "🟢 <b>Step 6/7 — Minimum Redeem / Withdrawal (₹):</b>\\n"
        "Enter the minimum withdrawal threshold in INR (e.g. <code>20</code> or <code>50</code>):",
        reply_markup=kb.cancel_fsm_kb("admin_panel"),
        parse_mode="HTML",
    )


@router.message(AddBotFSM.waiting_for_min_withdraw, F.text)
async def fsm_bot_min_withdraw(message: Message, state: FSMContext) -> None:
    try:
        min_w = float(message.text.strip().replace("₹", ""))
        if min_w < 0:
            raise ValueError
    except ValueError:
        await message.answer("🔴 Please enter a valid numeric minimum withdrawal amount.", parse_mode="HTML")
        return

    await state.update_data(min_withdraw=min_w)
    await state.set_state(AddBotFSM.waiting_for_description)
    await message.answer(
        "🟢 <b>Step 7/7 — Description & Payout Notes:</b>\\n"
        "Enter any extra description or payout instructions (or type <code>skip</code>):",
        reply_markup=kb.cancel_fsm_kb("admin_panel"),
        parse_mode="HTML",
    )


@router.message(AddBotFSM.waiting_for_description, F.text)
async def fsm_bot_description(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    await state.clear()

    desc = "" if message.text.strip().lower() == "skip" else message.text.strip()
    bot_id = await db.add_bot(
        bot_name=data["bot_name"],
        bot_username=data["bot_username"],
        per_refer_amount=data["per_refer_amount"],
        min_withdraw=data["min_withdraw"],
        work_type=data["work_type"],
        force_channels_count=data["force_channels_count"],
        proof_status="Verified Paying",
        description=desc,
    )

    await message.answer(
        f"🟢 <b>New Refer Bot Added Successfully! (ID: #{bot_id})</b>\\n\\n"
        f"🤖 <b>Name:</b> {data['bot_name']} (@{data['bot_username']})\\n"
        f"💸 <b>Per Refer:</b> ₹{data['per_refer_amount']:g}\\n"
        f"🏦 <b>Min Withdraw:</b> ₹{data['min_withdraw']:g}\\n"
        f"⚙️ <b>Task:</b> {data['work_type']}\\n"
        f"📢 <b>Force Channels:</b> {data['force_channels_count']}",
        parse_mode="HTML",
    )
    await render_admin_home(message, edit=False)


# =====================================================================
# ADMIN: DELETE / MANAGE BOTS
# =====================================================================

@router.callback_query(F.data == "admin_manage_bots")
async def cb_admin_manage_bots(callback: CallbackQuery) -> None:
    if not await db.is_admin(callback.from_user.id, PRIMARY_ADMIN_ID):
        await callback.answer("🔴 Unauthorized.", show_alert=True)
        return

    bots = await db.get_all_bots()
    await callback.answer()
    if not bots:
        if callback.message:
            await callback.message.edit_text(
                "📭 <b>No Bots Available to Delete</b>",
                reply_markup=kb.admin_delete_bots_kb([]),
                parse_mode="HTML",
            )
        return

    if callback.message:
        await callback.message.edit_text(
            "🔴 <b>Delete / Manage Refer Bots</b>\\n\\n"
            "Tap any bot below to permanently remove it from the directory:",
            reply_markup=kb.admin_delete_bots_kb(bots),
            parse_mode="HTML",
        )


@router.callback_query(F.data.startswith("admin_del_bot:"))
async def cb_admin_del_bot(callback: CallbackQuery) -> None:
    if not await db.is_admin(callback.from_user.id, PRIMARY_ADMIN_ID):
        await callback.answer("🔴 Unauthorized.", show_alert=True)
        return

    bot_id = int(callback.data.split(":")[1])
    deleted = await db.delete_bot(bot_id)
    if deleted:
        await callback.answer("🟢 Bot removed from directory.")
    else:
        await callback.answer("🔴 Bot not found.", show_alert=True)

    bots = await db.get_all_bots()
    if callback.message:
        await callback.message.edit_text(
            "🔴 <b>Delete / Manage Refer Bots</b>\\n\\n"
            "Tap any bot below to permanently remove it from the directory:",
            reply_markup=kb.admin_delete_bots_kb(bots),
            parse_mode="HTML",
        )


# =====================================================================
# ADMIN: ADD & REMOVE FORCE CHANNELS
# =====================================================================

@router.callback_query(F.data == "admin_add_channel")
async def cb_admin_add_channel(callback: CallbackQuery, state: FSMContext) -> None:
    if not await db.is_admin(callback.from_user.id, PRIMARY_ADMIN_ID):
        await callback.answer("🔴 Unauthorized.", show_alert=True)
        return

    await state.set_state(AddForceChannelFSM.waiting_for_name)
    await callback.answer()
    if callback.message:
        await callback.message.edit_text(
            "🔵 <b>Add Force-Join Channel (Step 1/3)</b>\\n\\n"
            "Enter the display <b>Channel Name</b> (e.g. <i>Official Earner Updates</i>):",
            reply_markup=kb.cancel_fsm_kb("admin_panel"),
            parse_mode="HTML",
        )


@router.message(AddForceChannelFSM.waiting_for_name, F.text)
async def fsm_channel_name(message: Message, state: FSMContext) -> None:
    await state.update_data(channel_name=message.text.strip())
    await state.set_state(AddForceChannelFSM.waiting_for_id_or_username)
    await message.answer(
        "🔵 <b>Step 2/3 — Channel Username or Chat ID:</b>\\n"
        "Enter the public username (e.g. <code>@EarnerUpdates</code>) or numeric ID (e.g. <code>-1001234567890</code>).\\n"
        "<i>Note: Make sure the bot is promoted as an Admin in that channel!</i>",
        reply_markup=kb.cancel_fsm_kb("admin_panel"),
        parse_mode="HTML",
    )


@router.message(AddForceChannelFSM.waiting_for_id_or_username, F.text)
async def fsm_channel_id(message: Message, state: FSMContext) -> None:
    await state.update_data(channel_username_or_id=message.text.strip())
    await state.set_state(AddForceChannelFSM.waiting_for_invite_link)
    await message.answer(
        "🔵 <b>Step 3/3 — Channel Invite Link:</b>\\n"
        "Enter the full URL users will click to join (e.g. <code>https://t.me/EarnerUpdates</code>):",
        reply_markup=kb.cancel_fsm_kb("admin_panel"),
        parse_mode="HTML",
    )


@router.message(AddForceChannelFSM.waiting_for_invite_link, F.text)
async def fsm_channel_link(message: Message, state: FSMContext) -> None:
    link = message.text.strip()
    if not (link.startswith("https://t.me/") or link.startswith("http://") or link.startswith("https://")):
        await message.answer("🔴 Please provide a valid URL starting with <code>https://t.me/</code>.", parse_mode="HTML")
        return

    data = await state.get_data()
    await state.clear()

    await db.add_force_channel(
        channel_name=data["channel_name"],
        channel_username_or_id=data["channel_username_or_id"],
        invite_link=link,
    )
    await message.answer(
        f"🟢 <b>Force Channel Added!</b>\\n"
        f"📢 <b>{data['channel_name']}</b> (<code>{data['channel_username_or_id']}</code>)",
        parse_mode="HTML",
    )
    await render_admin_home(message, edit=False)


@router.callback_query(F.data == "admin_remove_channel")
async def cb_admin_remove_channel(callback: CallbackQuery) -> None:
    if not await db.is_admin(callback.from_user.id, PRIMARY_ADMIN_ID):
        await callback.answer("🔴 Unauthorized.", show_alert=True)
        return

    channels = await db.get_force_channels()
    await callback.answer()
    if callback.message:
        await callback.message.edit_text(
            "🔴 <b>Remove Force-Join Channels</b>\\n\\n"
            "Tap a channel below to remove it from mandatory `/start` verification:",
            reply_markup=kb.admin_remove_channels_kb(channels),
            parse_mode="HTML",
        )


@router.callback_query(F.data.startswith("admin_del_channel:"))
async def cb_admin_del_channel(callback: CallbackQuery) -> None:
    if not await db.is_admin(callback.from_user.id, PRIMARY_ADMIN_ID):
        await callback.answer("🔴 Unauthorized.", show_alert=True)
        return

    ch_id = int(callback.data.split(":")[1])
    await db.delete_force_channel(ch_id)
    await callback.answer("🟢 Force channel removed.")

    channels = await db.get_force_channels()
    if callback.message:
        await callback.message.edit_text(
            "🔴 <b>Remove Force-Join Channels</b>\\n\\n"
            "Tap a channel below to remove it from mandatory `/start` verification:",
            reply_markup=kb.admin_remove_channels_kb(channels),
            parse_mode="HTML",
        )


# =====================================================================
# ADMIN: REVIEW SUBMISSIONS (APPROVE / REJECT)
# =====================================================================

@router.callback_query(F.data == "admin_review_submissions")
async def cb_admin_review_submissions(callback: CallbackQuery, bot: Bot) -> None:
    if not await db.is_admin(callback.from_user.id, PRIMARY_ADMIN_ID):
        await callback.answer("🔴 Unauthorized.", show_alert=True)
        return

    pending = await db.get_pending_submissions()
    await callback.answer()

    if not pending:
        if callback.message:
            await callback.message.answer(
                "🟢 <b>All Caught Up!</b> There are currently 0 pending submissions to review.",
                parse_mode="HTML",
            )
            await render_admin_home(callback, edit=False)
        return

    sub = pending[0]
    caption = (
        f"🟡 <b>Pending Submission Review (#{sub['id']})</b>\\n"
        f"Queue Remaining: <code>{len(pending)}</code>\\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\\n"
        f"👤 <b>User:</b> {sub['user_name']} (<code>{sub['user_id']}</code>)\\n"
        f"🤖 <b>Bot:</b> {sub.get('bot_name') or 'Unknown Bot'}\\n"
        f"💰 <b>Reward Rate:</b> ₹{sub.get('per_refer_amount') or 0:g}/refer\\n"
        f"📝 <b>User Note:</b> {sub.get('user_note') or 'None'}\\n"
        f"🕒 <b>Submitted:</b> {sub['submitted_at']}"
    )

    if callback.message:
        try:
            await bot.send_photo(
                chat_id=callback.from_user.id,
                photo=sub["screenshot_file_id"],
                caption=caption,
                reply_markup=kb.submission_review_action_kb(sub["id"]),
                parse_mode="HTML",
            )
        except TelegramBadRequest:
            await callback.message.answer(
                caption + f"\\n🖼 <b>File ID:</b> <code>{sub['screenshot_file_id']}</code>",
                reply_markup=kb.submission_review_action_kb(sub["id"]),
                parse_mode="HTML",
            )


@router.callback_query(F.data.startswith("admin_sub_decision:"))
async def cb_admin_sub_decision(callback: CallbackQuery, bot: Bot) -> None:
    if not await db.is_admin(callback.from_user.id, PRIMARY_ADMIN_ID):
        await callback.answer("🔴 Unauthorized.", show_alert=True)
        return

    _, action, sub_id_str = callback.data.split(":")
    sub_id = int(sub_id_str)
    sub = await db.get_submission_by_id(sub_id)

    if not sub:
        await callback.answer("🔴 Submission not found.", show_alert=True)
        return

    if sub["status"] != "pending":
        await callback.answer(f"⚠️ Already marked as {sub['status']}.", show_alert=True)
        return

    new_status = "approved" if action == "approve" else "rejected"
    await db.update_submission_status(sub_id, new_status)

    badge = "🟢 APPROVED" if new_status == "approved" else "🔴 REJECTED"
    await callback.answer(f"Submission #{sub_id} {badge}!")

    user_notice = (
        f"🎉 <b>Your Earning Proof (#{sub_id}) Was Approved!</b>\\n\\n"
        f"🤖 <b>Bot:</b> {sub.get('bot_name')}\\n"
        f"🟢 Your referral proof has been verified by our admin team."
        if new_status == "approved"
        else f"🔴 <b>Your Earning Proof (#{sub_id}) Was Rejected</b>\\n\\n"
        f"🤖 <b>Bot:</b> {sub.get('bot_name')}\\n"
        f"Please ensure your screenshot clearly shows completed referrals and try again."
    )
    try:
        await bot.send_message(
            chat_id=sub["user_id"], text=user_notice, parse_mode="HTML"
        )
    except Exception as exc:
        logger.warning("Could not notify user %s about submission %s: %s", sub["user_id"], sub_id, exc)

    if callback.message:
        try:
            await callback.message.edit_reply_markup(reply_markup=None)
        except TelegramBadRequest:
            pass
        await callback.message.answer(
            f"✅ Submission <b>#{sub_id}</b> marked as <b>{badge}</b>.",
            parse_mode="HTML",
        )


# =====================================================================
# ADMIN: ADD NEW ADMIN & BROADCAST
# =====================================================================

@router.callback_query(F.data == "admin_add_admin")
async def cb_admin_add_admin(callback: CallbackQuery, state: FSMContext) -> None:
    if not await db.is_admin(callback.from_user.id, PRIMARY_ADMIN_ID):
        await callback.answer("🔴 Unauthorized.", show_alert=True)
        return

    await state.set_state(AddAdminFSM.waiting_for_user_id)
    await callback.answer()
    if callback.message:
        await callback.message.edit_text(
            "👥 <b>Add New Admin</b>\\n\\n"
            "Send the numeric <b>Telegram User ID</b> of the new admin (e.g. <code>987654321</code>):",
            reply_markup=kb.cancel_fsm_kb("admin_panel"),
            parse_mode="HTML",
        )


@router.message(AddAdminFSM.waiting_for_user_id, F.text)
async def fsm_add_admin(message: Message, state: FSMContext) -> None:
    try:
        new_admin_id = int(message.text.strip())
    except ValueError:
        await message.answer("🔴 Please enter a valid numeric Telegram User ID.")
        return

    await state.clear()
    await db.add_admin(new_admin_id)
    await message.answer(
        f"🟢 User ID <code>{new_admin_id}</code> has been granted Admin privileges!",
        parse_mode="HTML",
    )
    await render_admin_home(message, edit=False)


@router.callback_query(F.data == "admin_broadcast")
async def cb_admin_broadcast(callback: CallbackQuery, state: FSMContext) -> None:
    if not await db.is_admin(callback.from_user.id, PRIMARY_ADMIN_ID):
        await callback.answer("🔴 Unauthorized.", show_alert=True)
        return

    await state.set_state(BroadcastFSM.waiting_for_message)
    await callback.answer()
    if callback.message:
        await callback.message.edit_text(
            "📢 <b>Broadcast Message to All Users</b>\\n\\n"
            "Send the message (text or photo with caption) you want to broadcast to all registered users:",
            reply_markup=kb.cancel_fsm_kb("admin_panel"),
            parse_mode="HTML",
        )


@router.message(BroadcastFSM.waiting_for_message)
async def fsm_broadcast_execute(message: Message, state: FSMContext, bot: Bot) -> None:
    await state.clear()
    user_ids = await db.get_all_user_ids()
    sent_count = 0
    failed_count = 0

    status_msg = await message.answer(
        f"📢 Broadcasting to <code>{len(user_ids)}</code> users...", parse_mode="HTML"
    )

    for uid in user_ids:
        try:
            await message.copy_to(chat_id=uid)
            sent_count += 1
        except (TelegramForbiddenError, TelegramBadRequest):
            failed_count += 1
        except Exception:
            failed_count += 1

    await status_msg.edit_text(
        f"🟢 <b>Broadcast Complete!</b>\\n\\n"
        f"✅ Delivered: <code>{sent_count}</code>\\n"
        f"🔴 Failed/Blocked: <code>{failed_count}</code>",
        parse_mode="HTML",
    )
    await render_admin_home(message, edit=False)`
  },
  {
    name: 'requirements.txt',
    language: 'text',
    description: 'Exact tested dependencies for Python 3.11+ on Render.',
    lines: 3,
    content: `aiogram==3.13.1
aiosqlite==0.20.0
aiohttp==3.10.10`
  },
  {
    name: 'Procfile',
    language: 'text',
    description: 'Render Web Service process declaration running main.py.',
    lines: 1,
    content: `web: python main.py`
  },
  {
    name: 'render.yaml',
    language: 'yaml',
    description: 'Optional Render Blueprint for automated GitHub repository deployment.',
    lines: 14,
    content: `services:
  - type: web
    name: refer-earn-bot-tracker
    runtime: python
    plan: free
    buildCommand: pip install -r requirements.txt
    startCommand: python main.py
    healthCheckPath: /
    envVars:
      - key: BOT_TOKEN
        sync: false
      - key: ADMIN_ID
        sync: false`
  }
];
