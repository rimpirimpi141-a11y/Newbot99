from typing import List, Dict, Any
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
    return builder.as_markup()
