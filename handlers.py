import os
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
    Returns a list of channels from `force_channels` that the user has NOT joined yet.
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
            # If the bot is not admin in that channel or channel ID is invalid, do not lock out users unnecessarily
            continue

    return unjoined


async def send_main_menu(
    target: Message | CallbackQuery, user_id: int, full_name: str, edit: bool = False
) -> None:
    is_adm = await db.is_admin(user_id, PRIMARY_ADMIN_ID)
    total_bots = await db.count_bots()
    text = (
        f"🌟 <b>Welcome to Refer & Earn Tracker, {full_name}!</b>\n\n"
        f"🟢 <b>Active Verified Bots:</b> <code>{total_bots}</code>\n"
        f"🔵 Track the highest-paying Refer & Earn bots, verify instant withdrawal limits, "
        f"and submit your earning proofs directly for fast approval.\n\n"
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
            "🔒 <b>Mandatory Channel Verification Required</b>\n\n"
            "To access verified Refer & Earn bots and submit payout proofs, "
            "please join all official channels listed below first:\n\n"
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
                "📭 <b>No Refer & Earn Bots Listed Yet</b>\n\n"
                "Our admins are currently verifying new high-paying refer bots. Check back soon!",
                reply_markup=kb.back_to_main_kb(),
                parse_mode="HTML",
            )
        return

    current_page = (offset // PAGE_SIZE) + 1
    total_pages = (total + PAGE_SIZE - 1) // PAGE_SIZE
    text = (
        f"🟢 <b>Verified Refer & Earn Bots Directory</b>\n"
        f"📄 Page <code>{current_page}/{total_pages}</code> • Total Tracked: <code>{total}</code>\n\n"
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
        f"🤖 <b>{bot_info['bot_name']}</b> (@{bot_info['bot_username']})\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🟢 <b>Reward per Refer:</b> ₹{bot_info['per_refer_amount']:g}\n"
        f"🏦 <b>Minimum Withdrawal:</b> ₹{bot_info['min_withdraw']:g}\n"
        f"⚙️ <b>Work / Task Required:</b> {bot_info['work_type']}\n"
        f"📢 <b>Force Channels in Bot:</b> {bot_info['force_channels_count']} channel(s)\n"
        f"✅ <b>Payout Status:</b> {bot_info['proof_status']}\n"
    )
    if bot_info.get("description"):
        text += f"\n📝 <b>Notes:</b> {bot_info['description']}\n"

    text += (
        "\n💡 <i>Click the green button below to launch the bot, complete your referrals, "
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
            "🔵 <b>Submit Earning / Withdrawal Proof</b>\n\n"
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
            f"🔵 <b>Submitting Proof for: {bot_info['bot_name']}</b>\n"
            f"💰 <b>Rate:</b> ₹{bot_info['per_refer_amount']:g} / refer\n\n"
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
        "📸 <b>Step 2 of 2: Upload Screenshot Proof</b>\n\n"
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
        f"🟢 <b>Proof Submitted Successfully! (ID: #{submission_id})</b>\n\n"
        f"🤖 <b>Bot:</b> {data['bot_name']}\n"
        f"📝 <b>Details:</b> {data.get('user_note', 'N/A')}\n"
        f"⏳ <b>Status:</b> Pending Admin Review\n\n"
        f"You will receive an instant notification as soon as an admin reviews your proof.",
        reply_markup=kb.back_to_main_kb(),
        parse_mode="HTML",
    )

    # Ping all active admins with the screenshot and one-tap review buttons
    admin_ids = await db.get_all_admins(PRIMARY_ADMIN_ID)
    admin_caption = (
        f"🔔 <b>New Earning Proof Submitted! (#{submission_id})</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 <b>User:</b> {user_display} (<code>{user.id}</code>)\n"
        f"🤖 <b>Bot:</b> {data['bot_name']}\n"
        f"💸 <b>Per Refer Rate:</b> ₹{data['per_refer_amount']:g}\n"
        f"📝 <b>Claim Details:</b> {data.get('user_note', 'N/A')}\n"
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
                "📊 <b>My Submissions</b>\n\n"
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

    lines = ["📊 <b>Your Recent Earning Proof Submissions:</b>\n"]
    for s in subs:
        badge = status_icons.get(s["status"], s["status"])
        bot_title = s.get("bot_name") or f"Bot #{s['bot_id']}"
        lines.append(
            f"• <b>#{s['id']}</b> — <b>{bot_title}</b>: {badge}\n"
            f"  <i>Note: {s.get('user_note') or 'No note'}</i>"
        )

    if callback.message:
        await callback.message.edit_text(
            "\n".join(lines),
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
        "🛠️ <b>Admin Control Center</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🟢 <b>Tracked Refer Bots:</b> <code>{bots_count}</code>\n"
        f"🔵 <b>Active Force Channels:</b> <code>{len(channels)}</code>\n"
        f"🟡 <b>Pending Proofs to Review:</b> <code>{len(pending)}</code>\n"
        f"👥 <b>Authorized Admins:</b> <code>{len(admins)}</code>\n"
        f"📊 <b>Total Registered Users:</b> <code>{len(users)}</code>\n\n"
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
            "🟢 <b>Add New Refer Bot (Step 1/7)</b>\n\n"
            "Enter the display <b>Name</b> of the Refer & Earn Bot (e.g. <i>CashKing Refer Bot</i>):",
            reply_markup=kb.cancel_fsm_kb("admin_panel"),
            parse_mode="HTML",
        )


@router.message(AddBotFSM.waiting_for_name, F.text)
async def fsm_bot_name(message: Message, state: FSMContext) -> None:
    await state.update_data(bot_name=message.text.strip())
    await state.set_state(AddBotFSM.waiting_for_username)
    await message.answer(
        "🟢 <b>Step 2/7 — Bot Username:</b>\n"
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
        "🟢 <b>Step 3/7 — Per Refer Payout (₹):</b>\n"
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
        "🟢 <b>Step 4/7 — Task / Work Type:</b>\n"
        "Describe the task required (e.g. <i>Join Channels & Verify Captcha</i> or <i>Instant Auto-Approve</i>):",
        reply_markup=kb.cancel_fsm_kb("admin_panel"),
        parse_mode="HTML",
    )


@router.message(AddBotFSM.waiting_for_work_type, F.text)
async def fsm_bot_work_type(message: Message, state: FSMContext) -> None:
    await state.update_data(work_type=message.text.strip())
    await state.set_state(AddBotFSM.waiting_for_force_count)
    await message.answer(
        "🟢 <b>Step 5/7 — Force Channels Count:</b>\n"
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
        "🟢 <b>Step 6/7 — Minimum Redeem / Withdrawal (₹):</b>\n"
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
        "🟢 <b>Step 7/7 — Description & Payout Notes:</b>\n"
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
        f"🟢 <b>New Refer Bot Added Successfully! (ID: #{bot_id})</b>\n\n"
        f"🤖 <b>Name:</b> {data['bot_name']} (@{data['bot_username']})\n"
        f"💸 <b>Per Refer:</b> ₹{data['per_refer_amount']:g}\n"
        f"🏦 <b>Min Withdraw:</b> ₹{data['min_withdraw']:g}\n"
        f"⚙️ <b>Task:</b> {data['work_type']}\n"
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
            "🔴 <b>Delete / Manage Refer Bots</b>\n\n"
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
            "🔴 <b>Delete / Manage Refer Bots</b>\n\n"
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
            "🔵 <b>Add Force-Join Channel (Step 1/3)</b>\n\n"
            "Enter the display <b>Channel Name</b> (e.g. <i>Official Earner Updates</i>):",
            reply_markup=kb.cancel_fsm_kb("admin_panel"),
            parse_mode="HTML",
        )


@router.message(AddForceChannelFSM.waiting_for_name, F.text)
async def fsm_channel_name(message: Message, state: FSMContext) -> None:
    await state.update_data(channel_name=message.text.strip())
    await state.set_state(AddForceChannelFSM.waiting_for_id_or_username)
    await message.answer(
        "🔵 <b>Step 2/3 — Channel Username or Chat ID:</b>\n"
        "Enter the public username (e.g. <code>@EarnerUpdates</code>) or numeric ID (e.g. <code>-1001234567890</code>).\n"
        "<i>Note: Make sure the bot is promoted as an Admin in that channel!</i>",
        reply_markup=kb.cancel_fsm_kb("admin_panel"),
        parse_mode="HTML",
    )


@router.message(AddForceChannelFSM.waiting_for_id_or_username, F.text)
async def fsm_channel_id(message: Message, state: FSMContext) -> None:
    await state.update_data(channel_username_or_id=message.text.strip())
    await state.set_state(AddForceChannelFSM.waiting_for_invite_link)
    await message.answer(
        "🔵 <b>Step 3/3 — Channel Invite Link:</b>\n"
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
        f"🟢 <b>Force Channel Added!</b>\n"
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
            "🔴 <b>Remove Force-Join Channels</b>\n\n"
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
            "🔴 <b>Remove Force-Join Channels</b>\n\n"
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
        f"🟡 <b>Pending Submission Review (#{sub['id']})</b>\n"
        f"Queue Remaining: <code>{len(pending)}</code>\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 <b>User:</b> {sub['user_name']} (<code>{sub['user_id']}</code>)\n"
        f"🤖 <b>Bot:</b> {sub.get('bot_name') or 'Unknown Bot'}\n"
        f"💰 <b>Reward Rate:</b> ₹{sub.get('per_refer_amount') or 0:g}/refer\n"
        f"📝 <b>User Note:</b> {sub.get('user_note') or 'None'}\n"
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
            # Fallback if screenshot_file_id is synthetic/test string
            await callback.message.answer(
                caption + f"\n🖼 <b>File ID:</b> <code>{sub['screenshot_file_id']}</code>",
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

    # Notify the user who submitted the proof
    user_notice = (
        f"🎉 <b>Your Earning Proof (#{sub_id}) Was Approved!</b>\n\n"
        f"🤖 <b>Bot:</b> {sub.get('bot_name')}\n"
        f"🟢 Your referral proof has been verified by our admin team."
        if new_status == "approved"
        else f"🔴 <b>Your Earning Proof (#{sub_id}) Was Rejected</b>\n\n"
        f"🤖 <b>Bot:</b> {sub.get('bot_name')}\n"
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
            "👥 <b>Add New Admin</b>\n\n"
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
            "📢 <b>Broadcast Message to All Users</b>\n\n"
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
        f"🟢 <b>Broadcast Complete!</b>\n\n"
        f"✅ Delivered: <code>{sent_count}</code>\n"
        f"🔴 Failed/Blocked: <code>{failed_count}</code>",
        parse_mode="HTML",
    )
    await render_admin_home(message, edit=False)
