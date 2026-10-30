import os
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
        logger.info("Bot stopped gracefully.")
