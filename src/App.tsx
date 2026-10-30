/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Copy,
  Check,
  Download,
  Database,
  Code2,
  Smartphone,
  Server,
  ExternalLink,
  Trash2,
  Image as ImageIcon,
  ShieldCheck,
  UserCheck,
  RefreshCw,
} from 'lucide-react';
import { BOT_PROJECT_FILES, ProjectFile } from './botCode';

// =====================================================================
// TYPES (Mirroring aiosqlite Schema in database.py)
// =====================================================================

interface ReferBotRecord {
  id: number;
  bot_name: string;
  bot_username: string;
  per_refer_amount: number;
  min_withdraw: number;
  work_type: string;
  force_channels_count: number;
  proof_status: string;
  description: string;
  created_at: string;
}

interface ForceChannelRecord {
  id: number;
  channel_name: string;
  channel_username_or_id: string;
  invite_link: string;
}

interface SubmissionRecord {
  id: number;
  user_id: number;
  user_name: string;
  bot_id: number;
  bot_name: string;
  per_refer_amount: number;
  screenshot_file_id: string;
  user_note: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
}

interface InlineBtn {
  text: string;
  callbackData?: string;
  url?: string;
}

interface ChatMessage {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  photoPreview?: string;
  timestamp: string;
  keyboard?: InlineBtn[][];
}

type FSMState =
  | null
  | { flow: 'proof'; step: 'details' | 'screenshot'; botId: number; botName: string; rate: number; note?: string }
  | {
      flow: 'add_bot';
      step: 'name' | 'username' | 'per_refer' | 'work_type' | 'force_count' | 'min_withdraw' | 'description';
      draft: Partial<ReferBotRecord>;
    }
  | {
      flow: 'add_channel';
      step: 'name' | 'username_id' | 'invite_link';
      draft: Partial<ForceChannelRecord>;
    }
  | { flow: 'add_admin'; step: 'user_id' }
  | { flow: 'broadcast'; step: 'message' };

const SUPPORT_URL = 'https://t.me/aaditya334356';
const PRIMARY_ADMIN_ID = 558899112;
const DEMO_USER_ID = 781234901;

export default function App() {
  // Navigation section state
  const [activeSection, setActiveSection] = useState<'workspace' | 'codebase' | 'database' | 'deploy'>('workspace');

  // Simulated SQLite Database State (`bot_tracker.db`)
  const [bots, setBots] = useState<ReferBotRecord[]>([
    {
      id: 1,
      bot_name: 'CashKing Instant Refer Bot',
      bot_username: 'CashKingReferBot',
      per_refer_amount: 12,
      min_withdraw: 36,
      work_type: 'Join 3 Sponsor Channels & Verify Captcha',
      force_channels_count: 3,
      proof_status: 'Verified Paying',
      description: 'Instant UPI payout within 5 minutes of redeeming minimum threshold.',
      created_at: '2026-10-29 14:20:00',
    },
    {
      id: 2,
      bot_name: 'TaskPay Pro Rewards Bot',
      bot_username: 'TaskPayProBot',
      per_refer_amount: 8.5,
      min_withdraw: 25,
      work_type: 'Start Bot + Complete 1 Mini App Check-In',
      force_channels_count: 2,
      proof_status: 'Verified Paying',
      description: 'Supports both Paytm Wallet and UPI QR withdrawals.',
      created_at: '2026-10-29 18:05:12',
    },
    {
      id: 3,
      bot_name: 'RupeeRush Official Bot',
      bot_username: 'RupeeRushOfficialBot',
      per_refer_amount: 15,
      min_withdraw: 60,
      work_type: 'Join 4 Channels + Phone Verified Account',
      force_channels_count: 4,
      proof_status: 'Verified Paying',
      description: 'High per-referral payout with daily leaderboard bonuses.',
      created_at: '2026-10-30 09:15:44',
    },
  ]);

  const [forceChannels, setForceChannels] = useState<ForceChannelRecord[]>([
    {
      id: 1,
      channel_name: 'Official Refer & Earn Alerts',
      channel_username_or_id: '@ReferEarnAlertsHQ',
      invite_link: 'https://t.me/ReferEarnAlertsHQ',
    },
    {
      id: 2,
      channel_name: 'Verified Payout Proofs Live',
      channel_username_or_id: '@PayoutProofsLive',
      invite_link: 'https://t.me/PayoutProofsLive',
    },
  ]);

  const [admins, setAdmins] = useState<number[]>([PRIMARY_ADMIN_ID, 601928374]);

  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([
    {
      id: 101,
      user_id: DEMO_USER_ID,
      user_name: '@arjun_earner',
      bot_id: 1,
      bot_name: 'CashKing Instant Refer Bot',
      per_refer_amount: 12,
      screenshot_file_id: 'AgACAgUAAxkBAAIBY2c_proof_cashking_36inr',
      user_note: 'Completed 4 referrals (₹48 balance), UPI: arjun@okaxis',
      status: 'pending',
      submitted_at: '2026-10-30 10:12:09',
    },
    {
      id: 100,
      user_id: 892341122,
      user_name: '@priya_rewards',
      bot_id: 2,
      bot_name: 'TaskPay Pro Rewards Bot',
      per_refer_amount: 8.5,
      screenshot_file_id: 'AgACAgUAAxkBAAIBY2c_proof_taskpay_25inr',
      user_note: '3 referrals verified, withdrawn ₹25.5 to Paytm',
      status: 'approved',
      submitted_at: '2026-10-29 21:40:33',
    },
  ]);

  // Simulator Persona & Channel Join State
  const [simRole, setSimRole] = useState<'user' | 'admin'>('user');
  const [joinedChannelIds, setJoinedChannelIds] = useState<number[]>([1, 2]);
  const [fsmState, setFsmState] = useState<FSMState>(null);
  const [inputText, setInputText] = useState('');
  const [selectedFileTab, setSelectedFileTab] = useState<string>('main.py');
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const [dbTab, setDbTab] = useState<'bots' | 'force_channels' | 'submissions' | 'admins'>('bots');

  const currentUserId = simRole === 'admin' ? PRIMARY_ADMIN_ID : DEMO_USER_ID;
  const currentUserName = simRole === 'admin' ? '@admin_aaditya' : '@arjun_earner';

  const getNowTime = () => {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Build Main Menu Keyboard
  const buildMainMenuKb = (isAdmin: boolean): InlineBtn[][] => {
    const rows: InlineBtn[][] = [
      [{ text: '🟢 Browse Refer Bots', callbackData: 'browse_bots:0' }],
      [
        { text: '🔵 Submit Earning Proof', callbackData: 'submit_proof_menu' },
        { text: '📊 My Submissions', callbackData: 'my_submissions' },
      ],
      [{ text: '💬 Support & Contact', url: SUPPORT_URL }],
    ];
    if (isAdmin) {
      rows.push([{ text: '🛠️ Open Admin Control Panel', callbackData: 'admin_panel' }]);
    }
    return rows;
  };

  const buildAdminPanelKb = (pendingCount: number): InlineBtn[][] => [
    [
      { text: '🟢 Add New Refer Bot', callbackData: 'admin_add_bot' },
      { text: '🔴 Delete / Manage Bots', callbackData: 'admin_manage_bots' },
    ],
    [
      { text: '🔵 Add Force Channel', callbackData: 'admin_add_channel' },
      { text: '🔴 Remove Force Channel', callbackData: 'admin_remove_channel' },
    ],
    [
      {
        text: `🟡 Review Submissions${pendingCount > 0 ? ` (${pendingCount})` : ''}`,
        callbackData: 'admin_review_submissions',
      },
    ],
    [
      { text: '👥 Add New Admin', callbackData: 'admin_add_admin' },
      { text: '📢 Broadcast Message', callbackData: 'admin_broadcast' },
    ],
    [{ text: '🏠 Exit to User Main Menu', callbackData: 'back_main_menu' }],
  ];

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'init-1',
      sender: 'user',
      text: '/start',
      timestamp: '10:15 AM',
    },
    {
      id: 'init-2',
      sender: 'bot',
      text: `🌟 Welcome to Refer & Earn Tracker, Arjun!\n\n🟢 Active Verified Bots: 3\n🔵 Track the highest-paying Refer & Earn bots, verify instant withdrawal limits, and submit your earning proofs directly for fast approval.\n\n👇 Choose an option below to get started:`,
      timestamp: '10:15 AM',
      keyboard: [
        [{ text: '🟢 Browse Refer Bots', callbackData: 'browse_bots:0' }],
        [
          { text: '🔵 Submit Earning Proof', callbackData: 'submit_proof_menu' },
          { text: '📊 My Submissions', callbackData: 'my_submissions' },
        ],
        [{ text: '💬 Support & Contact', url: SUPPORT_URL }],
      ],
    },
  ]);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const pushBotMessage = (text: string, keyboard?: InlineBtn[][], photoPreview?: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sender: 'bot',
        text,
        keyboard,
        photoPreview,
        timestamp: getNowTime(),
      },
    ]);
  };

  const pushUserMessage = (text: string, photoPreview?: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sender: 'user',
        text,
        photoPreview,
        timestamp: getNowTime(),
      },
    ]);
  };

  // Check Force-Join helper
  const getUnjoinedChannels = (): ForceChannelRecord[] => {
    if (simRole === 'admin' || admins.includes(currentUserId)) return [];
    return forceChannels.filter((ch) => !joinedChannelIds.includes(ch.id));
  };

  const triggerForceJoinGate = (unjoined: ForceChannelRecord[]) => {
    const kbRows: InlineBtn[][] = unjoined.map((ch, idx) => [
      { text: `🔵 Join ${ch.channel_name} (#${idx + 1})`, url: ch.invite_link },
    ]);
    kbRows.push([{ text: '🟢 Verify / Check Join', callbackData: 'verify_force_join' }]);

    pushBotMessage(
      `🔒 Mandatory Channel Verification Required\n\nTo access verified Refer & Earn bots and submit payout proofs, please join all official channels listed below first.\n\nAfter joining, tap 🟢 Verify / Check Join.`,
      kbRows
    );
  };

  const showMainMenu = () => {
    const isAdm = simRole === 'admin' || admins.includes(currentUserId);
    pushBotMessage(
      `🌟 Welcome to Refer & Earn Tracker, ${simRole === 'admin' ? 'Admin Aaditya' : 'Arjun'}!\n\n🟢 Active Verified Bots: ${bots.length}\n🔵 Track the highest-paying Refer & Earn bots, verify instant withdrawal limits, and submit your earning proofs directly for fast approval.\n\n👇 Choose an option below to get started:`,
      buildMainMenuKb(isAdm)
    );
  };

  const showAdminHome = (overrideSubs?: SubmissionRecord[], overrideBots?: ReferBotRecord[], overrideChannels?: ForceChannelRecord[], overrideAdmins?: number[]) => {
    const activeSubs = overrideSubs ?? submissions;
    const activeBots = overrideBots ?? bots;
    const activeChans = overrideChannels ?? forceChannels;
    const activeAdms = overrideAdmins ?? admins;
    const pendingCount = activeSubs.filter((s) => s.status === 'pending').length;

    pushBotMessage(
      `🛠️ Admin Control Center\n━━━━━━━━━━━━━━━━━━━━━━\n🟢 Tracked Refer Bots: ${activeBots.length}\n🔵 Active Force Channels: ${activeChans.length}\n🟡 Pending Proofs to Review: ${pendingCount}\n👥 Authorized Admins: ${activeAdms.length}\n📊 Total Registered Users: 148\n\nSelect an administrative action below:`,
      buildAdminPanelKb(pendingCount)
    );
  };

  // Handle commands & FSM text input
  const handleSendText = (customText?: string) => {
    const raw = (customText ?? inputText).trim();
    if (!raw) return;
    if (!customText) setInputText('');

    pushUserMessage(raw);

    // 1. Slash commands override FSM
    if (raw === '/start') {
      setFsmState(null);
      const unjoined = getUnjoinedChannels();
      if (unjoined.length > 0) {
        triggerForceJoinGate(unjoined);
      } else {
        showMainMenu();
      }
      return;
    }

    if (raw === '/admin') {
      setFsmState(null);
      if (simRole !== 'admin' && !admins.includes(currentUserId)) {
        pushBotMessage('🔴 Access Denied: You are not authorized to view the Admin Panel.');
        return;
      }
      showAdminHome();
      return;
    }

    // 2. Active FSM handling
    if (fsmState) {
      if (fsmState.flow === 'proof') {
        if (fsmState.step === 'details') {
          if (raw.length < 3) {
            pushBotMessage('🔴 Please provide valid details (at least 3 characters).', [
              [{ text: '🔴 Cancel Operation', callbackData: 'cancel_fsm' }],
            ]);
            return;
          }
          setFsmState({ ...fsmState, step: 'screenshot', note: raw });
          pushBotMessage(
            `📸 Step 2 of 2: Upload Screenshot Proof\n\nPlease send the photo/screenshot showing your referral balance or payout proof (Click the "Upload Demo Screenshot" button below the chat bar):`,
            [[{ text: '🔴 Cancel Operation', callbackData: 'cancel_fsm' }]]
          );
          return;
        }
        if (fsmState.step === 'screenshot') {
          pushBotMessage(
            '🔴 Please upload a valid Photo / Screenshot (use the "Send Proof Screenshot" button below) to complete your submission.',
            [[{ text: '🔴 Cancel Operation', callbackData: 'cancel_fsm' }]]
          );
          return;
        }
      }

      if (fsmState.flow === 'add_bot') {
        const d = { ...fsmState.draft };
        if (fsmState.step === 'name') {
          d.bot_name = raw;
          setFsmState({ flow: 'add_bot', step: 'username', draft: d });
          pushBotMessage('🟢 Step 2/7 — Bot Username:\nEnter the Telegram username of the bot (e.g. @CashKingReferBot):', [
            [{ text: '🔴 Cancel Operation', callbackData: 'admin_panel' }],
          ]);
          return;
        }
        if (fsmState.step === 'username') {
          const clean = raw.replace(/^@/, '');
          if (clean.includes(' ') || clean.length < 3) {
            pushBotMessage('🔴 Invalid username. Please enter a valid bot username without spaces.');
            return;
          }
          d.bot_username = clean;
          setFsmState({ flow: 'add_bot', step: 'per_refer', draft: d });
          pushBotMessage('🟢 Step 3/7 — Per Refer Payout (₹):\nEnter the numeric reward per referral in INR (e.g. 5 or 12.5):', [
            [{ text: '🔴 Cancel Operation', callbackData: 'admin_panel' }],
          ]);
          return;
        }
        if (fsmState.step === 'per_refer') {
          const val = parseFloat(raw.replace('₹', ''));
          if (isNaN(val) || val <= 0) {
            pushBotMessage('🔴 Please enter a valid positive number for Per Refer Pay (e.g. 10).');
            return;
          }
          d.per_refer_amount = val;
          setFsmState({ flow: 'add_bot', step: 'work_type', draft: d });
          pushBotMessage(
            '🟢 Step 4/7 — Task / Work Type:\nDescribe the task required (e.g. Join Channels & Verify Captcha):',
            [[{ text: '🔴 Cancel Operation', callbackData: 'admin_panel' }]]
          );
          return;
        }
        if (fsmState.step === 'work_type') {
          d.work_type = raw;
          setFsmState({ flow: 'add_bot', step: 'force_count', draft: d });
          pushBotMessage(
            '🟢 Step 5/7 — Force Channels Count:\nHow many force-join channels does this bot require users to join? (Enter an integer like 3):',
            [[{ text: '🔴 Cancel Operation', callbackData: 'admin_panel' }]]
          );
          return;
        }
        if (fsmState.step === 'force_count') {
          const cnt = parseInt(raw, 10);
          if (isNaN(cnt) || cnt < 0) {
            pushBotMessage('🔴 Please enter a valid non-negative integer (e.g. 3).');
            return;
          }
          d.force_channels_count = cnt;
          setFsmState({ flow: 'add_bot', step: 'min_withdraw', draft: d });
          pushBotMessage(
            '🟢 Step 6/7 — Minimum Redeem / Withdrawal (₹):\nEnter the minimum withdrawal threshold in INR (e.g. 20 or 50):',
            [[{ text: '🔴 Cancel Operation', callbackData: 'admin_panel' }]]
          );
          return;
        }
        if (fsmState.step === 'min_withdraw') {
          const minW = parseFloat(raw.replace('₹', ''));
          if (isNaN(minW) || minW < 0) {
            pushBotMessage('🔴 Please enter a valid numeric minimum withdrawal amount.');
            return;
          }
          d.min_withdraw = minW;
          setFsmState({ flow: 'add_bot', step: 'description', draft: d });
          pushBotMessage(
            '🟢 Step 7/7 — Description & Payout Notes:\nEnter any extra description or payout instructions (or type skip):',
            [[{ text: '🔴 Cancel Operation', callbackData: 'admin_panel' }]]
          );
          return;
        }
        if (fsmState.step === 'description') {
          const newBot: ReferBotRecord = {
            id: bots.length > 0 ? Math.max(...bots.map((b) => b.id)) + 1 : 1,
            bot_name: d.bot_name || 'New Refer Bot',
            bot_username: d.bot_username || 'NewReferBot',
            per_refer_amount: d.per_refer_amount || 5,
            min_withdraw: d.min_withdraw || 20,
            work_type: d.work_type || 'Standard Referral',
            force_channels_count: d.force_channels_count ?? 1,
            proof_status: 'Verified Paying',
            description: raw.toLowerCase() === 'skip' ? '' : raw,
            created_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
          };
          const nextBots = [newBot, ...bots];
          setBots(nextBots);
          setFsmState(null);
          pushBotMessage(
            `🟢 New Refer Bot Added Successfully! (ID: #${newBot.id})\n\n🤖 Name: ${newBot.bot_name} (@${newBot.bot_username})\n💸 Per Refer: ₹${newBot.per_refer_amount}\n🏦 Min Withdraw: ₹${newBot.min_withdraw}\n⚙️ Task: ${newBot.work_type}\n📢 Force Channels: ${newBot.force_channels_count}`
          );
          showAdminHome(submissions, nextBots, forceChannels, admins);
          return;
        }
      }

      if (fsmState.flow === 'add_channel') {
        const d = { ...fsmState.draft };
        if (fsmState.step === 'name') {
          d.channel_name = raw;
          setFsmState({ flow: 'add_channel', step: 'username_id', draft: d });
          pushBotMessage(
            '🔵 Step 2/3 — Channel Username or Chat ID:\nEnter the public username (e.g. @EarnerUpdates) or numeric ID (e.g. -1001234567890):',
            [[{ text: '🔴 Cancel Operation', callbackData: 'admin_panel' }]]
          );
          return;
        }
        if (fsmState.step === 'username_id') {
          d.channel_username_or_id = raw;
          setFsmState({ flow: 'add_channel', step: 'invite_link', draft: d });
          pushBotMessage(
            '🔵 Step 3/3 — Channel Invite Link:\nEnter the full URL users will click to join (e.g. https://t.me/EarnerUpdates):',
            [[{ text: '🔴 Cancel Operation', callbackData: 'admin_panel' }]]
          );
          return;
        }
        if (fsmState.step === 'invite_link') {
          if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
            pushBotMessage('🔴 Please provide a valid URL starting with https://t.me/');
            return;
          }
          const newCh: ForceChannelRecord = {
            id: forceChannels.length > 0 ? Math.max(...forceChannels.map((c) => c.id)) + 1 : 1,
            channel_name: d.channel_name || 'Sponsor Channel',
            channel_username_or_id: d.channel_username_or_id || '@SponsorChannel',
            invite_link: raw,
          };
          const nextChans = [...forceChannels, newCh];
          setForceChannels(nextChans);
          setJoinedChannelIds((prev) => [...prev, newCh.id]);
          setFsmState(null);
          pushBotMessage(`🟢 Force Channel Added!\n📢 ${newCh.channel_name} (${newCh.channel_username_or_id})`);
          showAdminHome(submissions, bots, nextChans, admins);
          return;
        }
      }

      if (fsmState.flow === 'add_admin') {
        const parsedId = parseInt(raw, 10);
        if (isNaN(parsedId) || parsedId < 10000) {
          pushBotMessage('🔴 Please enter a valid numeric Telegram User ID (e.g. 987654321).');
          return;
        }
        const nextAdmins = Array.from(new Set([...admins, parsedId]));
        setAdmins(nextAdmins);
        setFsmState(null);
        pushBotMessage(`🟢 User ID ${parsedId} has been granted Admin privileges!`);
        showAdminHome(submissions, bots, forceChannels, nextAdmins);
        return;
      }

      if (fsmState.flow === 'broadcast') {
        setFsmState(null);
        pushBotMessage(`🟢 Broadcast Complete!\n\n📢 Message: "${raw}"\n✅ Delivered: 148 users\n🔴 Failed/Blocked: 0`);
        showAdminHome();
        return;
      }
    }

    // Default fallback if no FSM active
    pushBotMessage('💡 Use the inline buttons above or send /start for the User Menu or /admin for the Admin Control Panel.');
  };

  // Handle simulated screenshot upload during ProofSubmissionFSM
  const handleSendScreenshotProof = () => {
    if (!fsmState || fsmState.flow !== 'proof' || fsmState.step !== 'screenshot') return;

    const previewText = `Screenshot_Proof_${fsmState.botName.replace(/\s+/g, '_')}.jpg`;
    pushUserMessage(`📸 Attached Photo: ${previewText}`, previewText);

    const newId = submissions.length > 0 ? Math.max(...submissions.map((s) => s.id)) + 1 : 101;
    const newSub: SubmissionRecord = {
      id: newId,
      user_id: currentUserId,
      user_name: currentUserName,
      bot_id: fsmState.botId,
      bot_name: fsmState.botName,
      per_refer_amount: fsmState.rate,
      screenshot_file_id: `AgACAgUAAxkBAA_${newId}_verified_photo`,
      user_note: fsmState.note || 'Completed referrals',
      status: 'pending',
      submitted_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };

    const nextSubs = [newSub, ...submissions];
    setSubmissions(nextSubs);
    setFsmState(null);

    pushBotMessage(
      `🟢 Proof Submitted Successfully! (ID: #${newId})\n\n🤖 Bot: ${newSub.bot_name}\n📝 Details: ${newSub.user_note}\n⏳ Status: Pending Admin Review\n\n🔔 All active admins (${admins.length}) have been pinged with your screenshot for one-tap review.`,
      [[{ text: '🏠 Back to Main Menu', callbackData: 'back_main_menu' }]]
    );
  };

  // Handle Inline Keyboard Button Callbacks
  const handleCallbackButton = (btn: InlineBtn) => {
    if (btn.url) {
      return;
    }
    const data = btn.callbackData || '';

    if (data === 'verify_force_join') {
      const unjoined = getUnjoinedChannels();
      if (unjoined.length > 0) {
        pushBotMessage(
          `🔴 Verification Failed: You have not joined ${unjoined.map((u) => u.channel_name).join(', ')} yet! Toggle the channel join switch in the simulator bar above and tap Verify again.`,
          [
            ...unjoined.map((ch, idx) => [{ text: `🔵 Join ${ch.channel_name} (#${idx + 1})`, url: ch.invite_link }]),
            [{ text: '🟢 Verify / Check Join', callbackData: 'verify_force_join' }],
          ]
        );
        return;
      }
      pushBotMessage('🟢 Verification successful! All required force-join channels confirmed.');
      showMainMenu();
      return;
    }

    if (data === 'back_main_menu' || data === 'cancel_fsm') {
      setFsmState(null);
      showMainMenu();
      return;
    }

    if (data.startsWith('browse_bots:')) {
      const unjoined = getUnjoinedChannels();
      if (unjoined.length > 0) {
        triggerForceJoinGate(unjoined);
        return;
      }
      const offset = parseInt(data.split(':')[1] || '0', 10);
      const pageSize = 5;
      const slice = bots.slice(offset, offset + pageSize);

      if (bots.length === 0) {
        pushBotMessage('📭 No Refer & Earn Bots Listed Yet. Check back soon!', [
          [{ text: '🏠 Back to Main Menu', callbackData: 'back_main_menu' }],
        ]);
        return;
      }

      const rows: InlineBtn[][] = slice.map((b) => [
        {
          text: `🟢 ${b.bot_name} — ₹${b.per_refer_amount}/Refer`,
          callbackData: `bot_detail:${b.id}:${offset}`,
        },
      ]);

      const navRow: InlineBtn[] = [];
      if (offset > 0) {
        navRow.push({ text: '⬅️ Prev Page', callbackData: `browse_bots:${Math.max(0, offset - pageSize)}` });
      }
      if (offset + pageSize < bots.length) {
        navRow.push({ text: 'Next Page ➡️', callbackData: `browse_bots:${offset + pageSize}` });
      }
      if (navRow.length > 0) rows.push(navRow);
      rows.push([{ text: '🏠 Back to Main Menu', callbackData: 'back_main_menu' }]);

      const pageNum = Math.floor(offset / pageSize) + 1;
      const totalPages = Math.ceil(bots.length / pageSize);

      pushBotMessage(
        `🟢 Verified Refer & Earn Bots Directory\n📄 Page ${pageNum}/${totalPages} · Total Tracked: ${bots.length}\n\nSelect any bot below to view its per-refer payout, task requirements, minimum withdrawal threshold, and direct launch link:`,
        rows
      );
      return;
    }

    if (data.startsWith('bot_detail:')) {
      const parts = data.split(':');
      const botId = parseInt(parts[1], 10);
      const returnOffset = parseInt(parts[2] || '0', 10);
      const b = bots.find((item) => item.id === botId);
      if (!b) {
        pushBotMessage('🔴 Bot no longer exists.');
        return;
      }
      pushBotMessage(
        `🤖 ${b.bot_name} (@${b.bot_username})\n━━━━━━━━━━━━━━━━━━━━━━\n🟢 Reward per Refer: ₹${b.per_refer_amount}\n🏦 Minimum Withdrawal: ₹${b.min_withdraw}\n⚙️ Work / Task Required: ${b.work_type}\n📢 Force Channels in Bot: ${b.force_channels_count} channel(s)\n✅ Payout Status: ${b.proof_status}\n${b.description ? `\n📝 Notes: ${b.description}\n` : ''}\n💡 Click the green button below to launch the bot, complete your referrals, and then submit your screenshot proof here!`,
        [
          [{ text: `🟢 Launch @${b.bot_username} Now`, url: `https://t.me/${b.bot_username}` }],
          [{ text: '🔵 Submit Earning Proof for This Bot', callbackData: `select_proof_bot:${b.id}` }],
          [
            { text: '⬅️ Back to Bot List', callbackData: `browse_bots:${returnOffset}` },
            { text: '🏠 Main Menu', callbackData: 'back_main_menu' },
          ],
        ]
      );
      return;
    }

    if (data === 'submit_proof_menu') {
      setFsmState(null);
      if (bots.length === 0) {
        pushBotMessage('🔴 No bots available for proof submission yet.');
        return;
      }
      const rows: InlineBtn[][] = bots.map((b) => [
        { text: `🔵 ${b.bot_name} (₹${b.per_refer_amount}/ref)`, callbackData: `select_proof_bot:${b.id}` },
      ]);
      rows.push([{ text: '🔴 Cancel & Return', callbackData: 'back_main_menu' }]);
      pushBotMessage(
        '🔵 Submit Earning / Withdrawal Proof\n\nSelect the Refer & Earn bot you completed referrals or withdrawal for:',
        rows
      );
      return;
    }

    if (data.startsWith('select_proof_bot:')) {
      const botId = parseInt(data.split(':')[1], 10);
      const b = bots.find((item) => item.id === botId);
      if (!b) return;

      setFsmState({
        flow: 'proof',
        step: 'details',
        botId: b.id,
        botName: b.bot_name,
        rate: b.per_refer_amount,
      });

      pushBotMessage(
        `🔵 Submitting Proof for: ${b.bot_name}\n💰 Rate: ₹${b.per_refer_amount} / refer\n\n✍️ Step 1 of 2: Please type your referral count, UPI/Wallet details, or claim note in the chat input below (e.g. "Completed 5 referrals, UPI: name@upi"):`,
        [[{ text: '🔴 Cancel Operation', callbackData: 'cancel_fsm' }]]
      );
      return;
    }

    if (data === 'my_submissions') {
      const mySubs = submissions.filter((s) => s.user_id === currentUserId || simRole === 'user');
      if (mySubs.length === 0) {
        pushBotMessage(
          "📊 My Submissions\n\nYou haven't submitted any earning proofs yet. Tap 🔵 Submit Earning Proof from the main menu once you complete a task!",
          [[{ text: '🏠 Back to Main Menu', callbackData: 'back_main_menu' }]]
        );
        return;
      }
      const statusMap = {
        pending: '🟡 Pending',
        approved: '🟢 Approved',
        rejected: '🔴 Rejected',
      };
      const lines = mySubs.map(
        (s) => `• #${s.id} — ${s.bot_name}: ${statusMap[s.status]}\n  Note: ${s.user_note}`
      );
      pushBotMessage(`📊 Your Recent Earning Proof Submissions:\n\n${lines.join('\n\n')}`, [
        [{ text: '🏠 Back to Main Menu', callbackData: 'back_main_menu' }],
      ]);
      return;
    }

    // ADMIN PANEL CALLBACKS
    if (data === 'admin_panel') {
      setFsmState(null);
      if (simRole !== 'admin' && !admins.includes(currentUserId)) {
        pushBotMessage('🔴 Unauthorized access. Switch simulator persona to Admin first.');
        return;
      }
      showAdminHome();
      return;
    }

    if (data === 'admin_add_bot') {
      setFsmState({ flow: 'add_bot', step: 'name', draft: {} });
      pushBotMessage(
        '🟢 Add New Refer Bot (Step 1/7)\n\nEnter the display Name of the Refer & Earn Bot (e.g. MegaPay Refer Bot):',
        [[{ text: '🔴 Cancel Operation', callbackData: 'admin_panel' }]]
      );
      return;
    }

    if (data === 'admin_manage_bots') {
      const rows: InlineBtn[][] = bots.map((b) => [
        { text: `🔴 Delete ${b.bot_name} (@${b.bot_username})`, callbackData: `admin_del_bot:${b.id}` },
      ]);
      rows.push([{ text: '⬅️ Back to Admin Panel', callbackData: 'admin_panel' }]);
      pushBotMessage('🔴 Delete / Manage Refer Bots\n\nTap any bot below to permanently remove it from the directory:', rows);
      return;
    }

    if (data.startsWith('admin_del_bot:')) {
      const botId = parseInt(data.split(':')[1], 10);
      const target = bots.find((b) => b.id === botId);
      const nextBots = bots.filter((b) => b.id !== botId);
      setBots(nextBots);
      const rows: InlineBtn[][] = nextBots.map((b) => [
        { text: `🔴 Delete ${b.bot_name} (@${b.bot_username})`, callbackData: `admin_del_bot:${b.id}` },
      ]);
      rows.push([{ text: '⬅️ Back to Admin Panel', callbackData: 'admin_panel' }]);
      pushBotMessage(
        `🟢 Removed "${target?.bot_name || botId}" from directory.\n\nRemaining bots:`,
        rows
      );
      return;
    }

    if (data === 'admin_add_channel') {
      setFsmState({ flow: 'add_channel', step: 'name', draft: {} });
      pushBotMessage(
        '🔵 Add Force-Join Channel (Step 1/3)\n\nEnter the display Channel Name (e.g. Official Earner Updates):',
        [[{ text: '🔴 Cancel Operation', callbackData: 'admin_panel' }]]
      );
      return;
    }

    if (data === 'admin_remove_channel') {
      const rows: InlineBtn[][] = forceChannels.map((c) => [
        { text: `🔴 Remove ${c.channel_name} (${c.channel_username_or_id})`, callbackData: `admin_del_channel:${c.id}` },
      ]);
      rows.push([{ text: '⬅️ Back to Admin Panel', callbackData: 'admin_panel' }]);
      pushBotMessage(
        '🔴 Remove Force-Join Channels\n\nTap a channel below to remove it from mandatory /start verification:',
        rows
      );
      return;
    }

    if (data.startsWith('admin_del_channel:')) {
      const chId = parseInt(data.split(':')[1], 10);
      const nextChans = forceChannels.filter((c) => c.id !== chId);
      setForceChannels(nextChans);
      const rows: InlineBtn[][] = nextChans.map((c) => [
        { text: `🔴 Remove ${c.channel_name} (${c.channel_username_or_id})`, callbackData: `admin_del_channel:${c.id}` },
      ]);
      rows.push([{ text: '⬅️ Back to Admin Panel', callbackData: 'admin_panel' }]);
      pushBotMessage('🟢 Force channel removed. Remaining force-join channels:', rows);
      return;
    }

    if (data === 'admin_review_submissions') {
      const pending = submissions.filter((s) => s.status === 'pending');
      if (pending.length === 0) {
        pushBotMessage('🟢 All Caught Up! There are currently 0 pending submissions to review.');
        showAdminHome();
        return;
      }
      const sub = pending[0];
      pushBotMessage(
        `🟡 Pending Submission Review (#${sub.id})\nQueue Remaining: ${pending.length}\n━━━━━━━━━━━━━━━━━━━━━━\n👤 User: ${sub.user_name} (${sub.user_id})\n🤖 Bot: ${sub.bot_name}\n💰 Reward Rate: ₹${sub.per_refer_amount}/refer\n📝 User Note: ${sub.user_note}\n🕒 Submitted: ${sub.submitted_at}`,
        [
          [
            { text: '🟢 Approve Submission', callbackData: `admin_sub_decision:approve:${sub.id}` },
            { text: '🔴 Reject Submission', callbackData: `admin_sub_decision:reject:${sub.id}` },
          ],
          [{ text: '⬅️ Back to Admin Panel', callbackData: 'admin_panel' }],
        ],
        `Screenshot File ID: ${sub.screenshot_file_id}`
      );
      return;
    }

    if (data.startsWith('admin_sub_decision:')) {
      const [, decision, idStr] = data.split(':');
      const subId = parseInt(idStr, 10);
      const newStatus: 'approved' | 'rejected' = decision === 'approve' ? 'approved' : 'rejected';
      const nextSubs = submissions.map((s) => (s.id === subId ? { ...s, status: newStatus } : s));
      setSubmissions(nextSubs);

      const label = newStatus === 'approved' ? '🟢 APPROVED' : '🔴 REJECTED';
      pushBotMessage(
        `✅ Submission #${subId} marked as ${label}!\n🔔 Automatic Telegram notification sent to user.`
      );
      showAdminHome(nextSubs, bots, forceChannels, admins);
      return;
    }

    if (data === 'admin_add_admin') {
      setFsmState({ flow: 'add_admin', step: 'user_id' });
      pushBotMessage(
        '👥 Add New Admin\n\nSend the numeric Telegram User ID of the new admin (e.g. 987654321):',
        [[{ text: '🔴 Cancel Operation', callbackData: 'admin_panel' }]]
      );
      return;
    }

    if (data === 'admin_broadcast') {
      setFsmState({ flow: 'broadcast', step: 'message' });
      pushBotMessage(
        '📢 Broadcast Message to All Users\n\nSend the announcement message you want to broadcast to all registered bot users:',
        [[{ text: '🔴 Cancel Operation', callbackData: 'admin_panel' }]]
      );
      return;
    }
  };

  // Copy & Download utilities
  const handleCopyCode = (file: ProjectFile) => {
    navigator.clipboard.writeText(file.content);
    setCopiedFile(file.name);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  const handleDownloadFile = (file: ProjectFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAllBundle = () => {
    BOT_PROJECT_FILES.forEach((file, index) => {
      setTimeout(() => {
        handleDownloadFile(file);
      }, index * 180);
    });
  };

  const activeCodeFile = BOT_PROJECT_FILES.find((f) => f.name === selectedFileTab) || BOT_PROJECT_FILES[0];
  const pendingSubmissionsCount = submissions.filter((s) => s.status === 'pending').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* STRICT 3-ZONE TOP BAR CONTRACT */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-800 bg-slate-950/90 sticky top-0 z-30">
        {/* Zone 1: Brand Title (single text element, one line) */}
        <a
          href="#workspace"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('workspace');
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          ReferBot Studio
        </a>

        {/* Zone 2: 4 concise single-line text nav links */}
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            type="button"
            onClick={() => setActiveSection('workspace')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'workspace' ? 'text-white border-emerald-500' : 'border-transparent'
            }`}
          >
            Bot Simulator
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('codebase')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'codebase' ? 'text-white border-emerald-500' : 'border-transparent'
            }`}
          >
            Python Source
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('database')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'database' ? 'text-white border-emerald-500' : 'border-transparent'
            }`}
          >
            SQLite Tables
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('deploy')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
              activeSection === 'deploy' ? 'text-white border-emerald-500' : 'border-transparent'
            }`}
          >
            Render Guide
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleDownloadAllBundle}
            className="px-4 py-2 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Download All 7 Files
          </button>
        </div>
      </header>

      {/* MAIN CONTENT VIEWPORT */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8">
        {/* Summary Metrics Bar (Tabular Numerals, Unboxed Metadata) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="text-xs text-slate-400">Tracked Refer Bots</div>
            <div className="text-2xl font-bold text-white mt-1 font-mono tabular-nums">{bots.length}</div>
            <div className="text-xs text-slate-500 mt-1">
              Avg ₹{(bots.reduce((acc, b) => acc + b.per_refer_amount, 0) / Math.max(1, bots.length)).toFixed(1)} per refer · SQLite synced
            </div>
          </div>

          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="text-xs text-slate-400">Force-Join Channels</div>
            <div className="text-2xl font-bold text-white mt-1 font-mono tabular-nums">{forceChannels.length}</div>
            <div className="text-xs text-slate-500 mt-1">
              Verified on /start · {joinedChannelIds.length}/{forceChannels.length} joined in sandbox
            </div>
          </div>

          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="text-xs text-slate-400">Payout Proof Submissions</div>
            <div className="text-2xl font-bold text-white mt-1 font-mono tabular-nums">
              {pendingSubmissionsCount} <span className="text-sm font-normal text-amber-400">pending</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {submissions.length} total logged · One-tap admin review
            </div>
          </div>

          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="text-xs text-slate-400">Render Runtime Config</div>
            <div className="text-2xl font-bold text-emerald-400 mt-1 font-mono tabular-nums">2 Env Vars</div>
            <div className="text-xs text-slate-500 mt-1">
              BOT_TOKEN · ADMIN_ID · Port 8080 GET /
            </div>
          </div>
        </div>

        {/* =========================================================
            VIEW 1: WORKSPACE (LIVE SIMULATOR + CODE INSPECTOR SPLIT)
           ========================================================= */}
        {activeSection === 'workspace' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* LEFT 5 COLS: INTERACTIVE TELEGRAM BOT SIMULATOR */}
            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
              {/* Simulator Control Header */}
              <div className="p-4 border-b border-slate-800 bg-slate-950/60 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Smartphone className="w-4 h-4 text-sky-400" />
                    <span className="text-sm font-semibold text-white">Interactive Telegram Sandbox</span>
                  </div>

                  {/* Role Switcher (Functional Segmented Control) */}
                  <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setSimRole('user');
                        setFsmState(null);
                      }}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        simRole === 'user'
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      User ({DEMO_USER_ID})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSimRole('admin');
                        setFsmState(null);
                      }}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        simRole === 'admin'
                          ? 'bg-emerald-400 text-slate-950 font-semibold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Admin ({PRIMARY_ADMIN_ID})
                    </button>
                  </div>
                </div>

                {/* Force-Join Channel Simulation Toggles */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs">
                  <span className="text-slate-400">Simulate Channel Membership:</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {forceChannels.map((ch) => {
                      const isJoined = joinedChannelIds.includes(ch.id);
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => {
                            setJoinedChannelIds((prev) =>
                              prev.includes(ch.id) ? prev.filter((id) => id !== ch.id) : [...prev, ch.id]
                            );
                          }}
                          className={`px-2.5 py-1 rounded border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            isJoined
                              ? 'bg-emerald-950/60 border-emerald-700/70 text-emerald-300'
                              : 'bg-rose-950/60 border-rose-800/70 text-rose-300'
                          }`}
                        >
                          {isJoined ? 'Joined' : 'Not Joined'}: {ch.channel_username_or_id}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Quick Command Shortcuts */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleSendText('/start')}
                    className="px-3 py-1.5 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Send /start
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSimRole('admin');
                      setTimeout(() => handleSendText('/admin'), 30);
                    }}
                    className="px-3 py-1.5 text-xs font-mono bg-slate-800 hover:bg-slate-700 text-emerald-300 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Send /admin
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setJoinedChannelIds([]);
                      setSimRole('user');
                      setTimeout(() => handleSendText('/start'), 30);
                    }}
                    className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Test Force-Join Gate
                  </button>
                </div>
              </div>

              {/* Telegram Message Viewport */}
              <div className="h-[490px] overflow-y-auto p-4 space-y-4 bg-[#0E1621]">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                        msg.sender === 'user'
                          ? 'bg-[#2B5278] text-white'
                          : 'bg-[#182533] text-slate-100 border border-slate-800'
                      }`}
                    >
                      {msg.photoPreview && (
                        <div className="mb-2.5 p-3 rounded-lg bg-slate-900/90 border border-slate-700/80 flex items-center gap-2.5 text-sky-300">
                          <ImageIcon className="w-4 h-4 shrink-0" />
                          <span className="font-mono text-[11px] truncate">{msg.photoPreview}</span>
                        </div>
                      )}
                      <div>{msg.text}</div>
                      <div className="text-[10px] text-slate-400 text-right mt-1 font-mono tabular-nums">
                        {msg.timestamp}
                      </div>
                    </div>

                    {/* Telegram InlineKeyboardMarkup Buttons */}
                    {msg.keyboard && msg.keyboard.length > 0 && (
                      <div className="w-full max-w-[88%] mt-1.5 space-y-1">
                        {msg.keyboard.map((row, rIdx) => (
                          <div key={rIdx} className="grid gap-1" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
                            {row.map((btn, bIdx) =>
                              btn.url ? (
                                <a
                                  key={bIdx}
                                  href={btn.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-3 py-2 rounded-lg bg-[#203040] hover:bg-[#293d52] text-white text-xs font-medium text-center flex items-center justify-center gap-1.5 transition-colors truncate"
                                >
                                  <span className="truncate">{btn.text}</span>
                                  <ExternalLink className="w-3 h-3 opacity-75 shrink-0" />
                                </a>
                              ) : (
                                <button
                                  key={bIdx}
                                  type="button"
                                  onClick={() => handleCallbackButton(btn)}
                                  className="px-3 py-2 rounded-lg bg-[#203040] hover:bg-[#293d52] active:scale-[0.99] text-white text-xs font-medium text-center transition-all truncate cursor-pointer"
                                >
                                  {btn.text}
                                </button>
                              )
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Active FSM Helper Banner */}
              {fsmState && (
                <div className="px-4 py-2 bg-sky-950/80 border-t border-sky-800/70 flex items-center justify-between gap-2 text-xs text-sky-200">
                  <span className="font-mono truncate">
                    FSM Active: {fsmState.flow}.{fsmState.step}
                  </span>
                  {fsmState.flow === 'proof' && fsmState.step === 'screenshot' && (
                    <button
                      type="button"
                      onClick={handleSendScreenshotProof}
                      className="px-3 py-1 bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-semibold rounded-md whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      Send Proof Screenshot
                    </button>
                  )}
                </div>
              )}

              {/* Message Input Bar */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendText();
                }}
                className="p-3 bg-slate-950 border-t border-slate-800 flex items-center gap-2"
              >
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={
                    fsmState
                      ? `Type response for ${fsmState.flow} (${fsmState.step})...`
                      : 'Type /start, /admin, or FSM input...'
                  }
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send
                </button>
              </form>
            </div>

            {/* RIGHT 7 COLS: PRODUCTION PYTHON FILES & ARCHITECTURE */}
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
              {/* File Selector Tabs */}
              <div className="p-4 border-b border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {BOT_PROJECT_FILES.map((file) => (
                    <button
                      key={file.name}
                      type="button"
                      onClick={() => setSelectedFileTab(file.name)}
                      className={`px-3 py-1.5 text-xs font-mono rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        selectedFileTab === file.name
                          ? 'bg-emerald-400 text-slate-950 font-semibold'
                          : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                      }`}
                    >
                      {file.name}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyCode(activeCodeFile)}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedFile === activeCodeFile.name ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy {activeCodeFile.name}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadFile(activeCodeFile)}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </button>
                </div>
              </div>

              {/* File Description Bar */}
              <div className="px-5 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
                <span>{activeCodeFile.description}</span>
                <span className="font-mono tabular-nums shrink-0 ml-4">{activeCodeFile.lines} lines</span>
              </div>

              {/* Code Viewer */}
              <div className="h-[545px] overflow-y-auto p-5 bg-slate-950 font-mono text-xs leading-relaxed text-slate-200 select-all">
                <pre className="whitespace-pre overflow-x-auto">{activeCodeFile.content}</pre>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            VIEW 2: FULL PYTHON SOURCE CODE EXPLORER
           ========================================================= */}
        {activeSection === 'codebase' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div>
                <h1 className="text-2xl font-bold text-white">Complete Python Codebase (aiogram 3.x + aiosqlite)</h1>
                <p className="text-sm text-slate-400 mt-1">
                  All 7 files are also saved directly in the project root directory ready for Git push to Render.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadAllBundle}
                className="px-4 py-2.5 text-xs font-semibold bg-emerald-400 hover:bg-emerald-300 text-slate-950 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Download All Files
              </button>
            </div>

            <div className="grid grid-cols-1 gap-6">
              {BOT_PROJECT_FILES.map((file) => (
                <div key={file.name} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between gap-4">
                    <div>
                      <span className="font-mono text-sm font-semibold text-emerald-400">{file.name}</span>
                      <span className="text-slate-500 mx-2">·</span>
                      <span className="text-xs text-slate-400">{file.description}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyCode(file)}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        {copiedFile === file.name ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copy Code
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadFile(file)}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </button>
                    </div>
                  </div>
                  <div className="p-5 bg-slate-950 max-h-[420px] overflow-y-auto font-mono text-xs leading-relaxed text-slate-200">
                    <pre className="whitespace-pre overflow-x-auto">{file.content}</pre>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* =========================================================
            VIEW 3: LIVE SQLITE DATABASE TABLES (`bot_tracker.db`)
           ========================================================= */}
        {activeSection === 'database' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div>
                <h1 className="text-2xl font-bold text-white">SQLite Database Inspector (bot_tracker.db)</h1>
                <p className="text-sm text-slate-400 mt-1">
                  Live asynchronous schema state synchronized with the Telegram Bot Simulator.
                </p>
              </div>

              {/* Segmented Table Selector */}
              <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setDbTab('bots')}
                  className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    dbTab === 'bots' ? 'bg-emerald-400 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  bots ({bots.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDbTab('force_channels')}
                  className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    dbTab === 'force_channels'
                      ? 'bg-emerald-400 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  force_channels ({forceChannels.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDbTab('submissions')}
                  className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    dbTab === 'submissions'
                      ? 'bg-emerald-400 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  submissions ({submissions.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDbTab('admins')}
                  className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    dbTab === 'admins' ? 'bg-emerald-400 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  admins ({admins.length})
                </button>
              </div>
            </div>

            {/* Table 1: bots */}
            {dbTab === 'bots' && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-mono">
                        <th className="py-3 px-4">id</th>
                        <th className="py-3 px-4">bot_name</th>
                        <th className="py-3 px-4">bot_username</th>
                        <th className="py-3 px-4 text-right">per_refer_amount</th>
                        <th className="py-3 px-4 text-right">min_withdraw</th>
                        <th className="py-3 px-4">work_type</th>
                        <th className="py-3 px-4 text-right">force_channels_count</th>
                        <th className="py-3 px-4">proof_status</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {bots.map((b) => (
                        <tr key={b.id} className="hover:bg-slate-800/40">
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-400">#{b.id}</td>
                          <td className="py-3 px-4 font-medium text-white">{b.bot_name}</td>
                          <td className="py-3 px-4 font-mono text-sky-400">@{b.bot_username}</td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-400">
                            ₹{b.per_refer_amount}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                            ₹{b.min_withdraw}
                          </td>
                          <td className="py-3 px-4 text-slate-300">{b.work_type}</td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-300">
                            {b.force_channels_count}
                          </td>
                          <td className="py-3 px-4 text-emerald-400">{b.proof_status}</td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => setBots((prev) => prev.filter((item) => item.id !== b.id))}
                              className="p-1.5 text-rose-400 hover:bg-rose-950/60 rounded transition-colors cursor-pointer"
                              title="Delete Bot"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Table 2: force_channels */}
            {dbTab === 'force_channels' && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-mono">
                        <th className="py-3 px-4">id</th>
                        <th className="py-3 px-4">channel_name</th>
                        <th className="py-3 px-4">channel_username_or_id</th>
                        <th className="py-3 px-4">invite_link</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {forceChannels.map((ch) => (
                        <tr key={ch.id} className="hover:bg-slate-800/40">
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-400">#{ch.id}</td>
                          <td className="py-3 px-4 font-medium text-white">{ch.channel_name}</td>
                          <td className="py-3 px-4 font-mono text-sky-400">{ch.channel_username_or_id}</td>
                          <td className="py-3 px-4 font-mono text-slate-300">{ch.invite_link}</td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => setForceChannels((prev) => prev.filter((item) => item.id !== ch.id))}
                              className="p-1.5 text-rose-400 hover:bg-rose-950/60 rounded transition-colors cursor-pointer"
                              title="Remove Channel"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Table 3: submissions */}
            {dbTab === 'submissions' && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-mono">
                        <th className="py-3 px-4">id</th>
                        <th className="py-3 px-4">user_id</th>
                        <th className="py-3 px-4">user_name</th>
                        <th className="py-3 px-4">bot_id</th>
                        <th className="py-3 px-4">screenshot_file_id</th>
                        <th className="py-3 px-4">status</th>
                        <th className="py-3 px-4">submitted_at</th>
                        <th className="py-3 px-4 text-right">Quick Review</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {submissions.map((sub) => (
                        <tr key={sub.id} className="hover:bg-slate-800/40">
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-400">#{sub.id}</td>
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-300">{sub.user_id}</td>
                          <td className="py-3 px-4 font-medium text-white">{sub.user_name}</td>
                          <td className="py-3 px-4 text-slate-300">
                            #{sub.bot_id} ({sub.bot_name})
                          </td>
                          <td className="py-3 px-4 font-mono text-slate-400 truncate max-w-[180px]">
                            {sub.screenshot_file_id}
                          </td>
                          <td className="py-3 px-4 font-medium">
                            {sub.status === 'approved' && <span className="text-emerald-400">🟢 approved</span>}
                            {sub.status === 'pending' && <span className="text-amber-400">🟡 pending</span>}
                            {sub.status === 'rejected' && <span className="text-rose-400">🔴 rejected</span>}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-400">{sub.submitted_at}</td>
                          <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() =>
                                setSubmissions((prev) =>
                                  prev.map((s) => (s.id === sub.id ? { ...s, status: 'approved' } : s))
                                )
                              }
                              className="px-2.5 py-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 rounded text-xs cursor-pointer"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setSubmissions((prev) =>
                                  prev.map((s) => (s.id === sub.id ? { ...s, status: 'rejected' } : s))
                                )
                              }
                              className="px-2.5 py-1 bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded text-xs cursor-pointer"
                            >
                              Reject
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Table 4: admins */}
            {dbTab === 'admins' && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-mono">
                        <th className="py-3 px-4">user_id</th>
                        <th className="py-3 px-4">Role / Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {admins.map((admId) => (
                        <tr key={admId} className="hover:bg-slate-800/40">
                          <td className="py-3 px-4 font-mono tabular-nums text-white">{admId}</td>
                          <td className="py-3 px-4 text-slate-400">
                            {admId === PRIMARY_ADMIN_ID
                              ? 'Primary Admin (Seeded from env ADMIN_ID)'
                              : 'Secondary Admin (Added via /admin FSM)'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =========================================================
            VIEW 4: RENDER DEPLOYMENT BLUEPRINT
           ========================================================= */}
        {activeSection === 'deploy' && (
          <div className="max-w-4xl space-y-8">
            <div className="pb-4 border-b border-slate-800">
              <h1 className="text-2xl font-bold text-white">Deploying on Render via GitHub</h1>
              <p className="text-sm text-slate-400 mt-1">
                Engineered for zero-sleep Web Service operation using strictly two environment variables.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
                <div className="text-xs font-mono text-emerald-400">01. Environment Variables (Strictly 2)</div>
                <h3 className="text-base font-semibold text-white">Required Render Environment Keys</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Add only these two variables in your Render Web Service Environment tab. No external database URLs or webhook secrets are needed.
                </p>
                <div className="pt-2 space-y-2 font-mono text-xs">
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
                    <span className="text-sky-400">BOT_TOKEN</span>
                    <span className="text-slate-500">123456789:AAH... (from @BotFather)</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
                    <span className="text-emerald-400">ADMIN_ID</span>
                    <span className="text-slate-500">558899112 (Telegram numeric ID)</span>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
                <div className="text-xs font-mono text-sky-400">02. Render Web Service Settings</div>
                <h3 className="text-base font-semibold text-white">Build, Start & Keep-Alive Health Check</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  <code className="text-slate-200">main.py</code> starts an <code className="text-slate-200">aiohttp</code> server bound to <code className="text-slate-200">0.0.0.0:$PORT</code> (default <code className="text-slate-200">8080</code>) alongside <code className="text-slate-200">dp.start_polling(bot)</code>.
                </p>
                <div className="pt-2 space-y-2 font-mono text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex justify-between">
                    <span className="text-slate-400">Build Command:</span>
                    <span className="text-white">pip install -r requirements.txt</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex justify-between">
                    <span className="text-slate-400">Start Command:</span>
                    <span className="text-white">python main.py</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex justify-between">
                    <span className="text-slate-400">Health Check Path:</span>
                    <span className="text-emerald-400">GET / (200 OK JSON)</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
              <div className="text-xs font-mono text-amber-400">03. Force-Join Channel Setup Note</div>
              <h3 className="text-base font-semibold text-white">Making Force-Join Verification Work in Production</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                When adding a Force Channel via <code className="text-emerald-400">/admin</code> → <code className="text-sky-400">🔵 Add Force Channel</code>, promote your Telegram bot as an <strong>Administrator</strong> in that channel (only basic permission is required) so Telegram allows <code className="text-slate-200">bot.get_chat_member(chat_id, user_id)</code> to verify real-time user membership when users tap <strong>🟢 Verify / Check Join</strong>.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
