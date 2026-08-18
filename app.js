import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

(() => {
  "use strict";

  /* ============ Firebase ============ */
  let app, auth, db, dataRef, unsubscribeSnapshot = null;
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    setPersistence(auth, browserLocalPersistence).catch((e) => console.error(e));
  } catch (e) {
    console.error(e);
  }

  const THEME_KEY = "calendar.theme";

  let events = {};   // { "YYYY-MM-DD": [{id,title,time}] }
  let weekly = {};   // { 0..6: "text" }  0 = Sunday

  /* ============ State ============ */
  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth(); // 0-indexed
  let selectedDateStr = null;

  /* ============ Helpers ============ */
  const pad = (n) => String(n).padStart(2, "0");
  const toKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const monthAbbr = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const weekdayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const weekdayAbbr = ["sun","mon","tue","wed","thu","fri","sat"];

  const fmtTime = (t) => {
    if (!t) return "All day";
    const [h, m] = t.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${pad(m)} ${period}`;
  };

  const fmtDateLong = (y, m, d) => {
    const dt = new Date(y, m, d);
    return `${weekdayNames[dt.getDay()]}, ${monthNames[m]} ${d}, ${y}`;
  };

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ============ Natural language event parser ============ */
  function parseEventMessage(raw) {
    let text = raw.trim();
    if (!text) return null;

    const now = new Date();
    let targetDate = null; // {y,m,d}
    let targetTime = null; // "HH:MM"
    const consume = []; // substrings to strip from title

    // --- explicit numeric date: M/D or M/D/YYYY ---
    let m;
    if ((m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
      let mo = parseInt(m[1], 10) - 1;
      let da = parseInt(m[2], 10);
      let yr = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : now.getFullYear();
      if (mo >= 0 && mo <= 11 && da >= 1 && da <= 31) {
        targetDate = { y: yr, m: mo, d: da };
        consume.push(m[0]);
      }
    }

    // --- month name + day (+ year): "aug 20", "august 20th", "aug 20, 2026" ---
    if (!targetDate) {
      const monthPattern = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)";
      const re = new RegExp("\\b" + monthPattern + "\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b", "i");
      if ((m = text.match(re))) {
        const monWord = m[1].toLowerCase().slice(0, 3);
        const mo = monthAbbr.indexOf(monWord);
        const da = parseInt(m[2], 10);
        const yr = m[3] ? parseInt(m[3], 10) : now.getFullYear();
        if (mo !== -1 && da >= 1 && da <= 31) {
          targetDate = { y: yr, m: mo, d: da };
          consume.push(m[0]);
        }
      }
    }

    // --- relative words: today / tomorrow ---
    if (!targetDate && /\btoday\b/i.test(text)) {
      targetDate = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
      consume.push(text.match(/\btoday\b/i)[0]);
    }
    if (!targetDate && /\btomorrow\b/i.test(text)) {
      const t = new Date(now); t.setDate(t.getDate() + 1);
      targetDate = { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
      consume.push(text.match(/\btomorrow\b/i)[0]);
    }

    // --- "in N days" ---
    if (!targetDate && (m = text.match(/\bin\s+(\d+)\s+days?\b/i))) {
      const t = new Date(now); t.setDate(t.getDate() + parseInt(m[1], 10));
      targetDate = { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
      consume.push(m[0]);
    }

    // --- "next <weekday>" or "<weekday>" ---
    if (!targetDate) {
      const wdPattern = "(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)";
      const reNext = new RegExp("\\bnext\\s+" + wdPattern + "\\b", "i");
      const rePlain = new RegExp("\\b" + wdPattern + "\\b", "i");
      let isNext = false;
      let wm = text.match(reNext);
      if (wm) { isNext = true; } else { wm = text.match(rePlain); }
      if (wm) {
        const word = wm[1].toLowerCase().slice(0, 3);
        const targetDow = weekdayAbbr.indexOf(word);
        if (targetDow !== -1) {
          const t = new Date(now);
          let diff = (targetDow - t.getDay() + 7) % 7;
          if (diff === 0) diff = isNext ? 7 : 0;
          t.setDate(t.getDate() + diff);
          targetDate = { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
          consume.push(wm[0]);
        }
      }
    }

    // --- time: "3pm", "3:30 pm", "at 15:00" ---
    if ((m = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i))) {
      let h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const ap = m[3] ? m[3].toLowerCase() : null;
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      targetTime = `${pad(h)}:${pad(min)}`;
      consume.push(m[0]);
    } else if ((m = text.match(/\b(\d{1,2})\s*(am|pm)\b/i))) {
      let h = parseInt(m[1], 10);
      const ap = m[2].toLowerCase();
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      targetTime = `${pad(h)}:00`;
      consume.push(m[0]);
    }

    // default date = today if none found
    const dateFound = !!targetDate;
    if (!targetDate) {
      targetDate = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
    }

    // strip matched fragments + filler connector words to build the title
    let title = text;
    for (const frag of consume) {
      title = title.replace(frag, " ");
    }
    title = title
      .replace(/\bat\b/gi, " ")
      .replace(/\bon\b/gi, " ")
      .replace(/\bnext\b/gi, " ")
      .replace(/,/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    title = title.replace(/^(for|the)\s+/i, "").trim();
    // drop leftover separator punctuation from stripping the date out of the middle/edges
    title = title.replace(/^[-–—:,\s]+|[-–—:,\s]+$/g, "").trim();
    if (!title) title = "Event";
    title = title.charAt(0).toUpperCase() + title.slice(1);

    return {
      title,
      dateKey: toKey(targetDate.y, targetDate.m, targetDate.d),
      dateLabel: fmtDateLong(targetDate.y, targetDate.m, targetDate.d),
      time: targetTime,
      dateFound,
    };
  }

  /* ============ Sync status ============ */
  const syncStatusEl = document.getElementById("syncStatus");
  function setSyncStatus(state) {
    syncStatusEl.className = "sync-status " + state;
    syncStatusEl.textContent = state === "synced" ? "Synced" : state === "syncing" ? "Syncing…" : "Offline";
  }

  /* ============ Firestore read/write ============ */
  async function writeData() {
    if (!dataRef) return;
    setSyncStatus("syncing");
    try {
      await setDoc(dataRef, { events, weekly });
      setSyncStatus("synced");
    } catch (e) {
      console.error(e);
      setSyncStatus("error");
      pushChat("Couldn't sync — check your connection.", "err");
    }
  }

  function listenToData(uid) {
    dataRef = doc(db, "users", uid, "calendar", "data");
    unsubscribeSnapshot = onSnapshot(
      dataRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          events = data.events || {};
          weekly = data.weekly || {};
        } else {
          events = {};
          weekly = {};
          setDoc(dataRef, { events, weekly });
        }
        renderCalendar();
        renderWeekly();
        renderUpcoming();
        if (selectedDateStr) renderModalEvents();
        setSyncStatus("synced");
      },
      (err) => {
        console.error(err);
        setSyncStatus("error");
      }
    );
  }

  /* ============ Event CRUD ============ */
  function addEvent(dateKey, title, time) {
    if (!events[dateKey]) events[dateKey] = [];
    events[dateKey].push({ id: Date.now() + Math.random().toString(36).slice(2, 6), title, time: time || null });
    events[dateKey].sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
    writeData();
  }

  function deleteEvent(dateKey, id) {
    if (!events[dateKey]) return;
    events[dateKey] = events[dateKey].filter((e) => e.id !== id);
    if (events[dateKey].length === 0) delete events[dateKey];
    writeData();
  }

  /* ============ Chat log ============ */
  const chatLog = document.getElementById("chatLog");
  function pushChat(html, kind) {
    const div = document.createElement("div");
    div.className = "chat-bubble" + (kind ? " " + kind : "");
    div.innerHTML = html;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  /* ============ Calendar rendering ============ */
  const monthLabel = document.getElementById("monthLabel");
  const grid = document.getElementById("grid");

  function renderCalendar(direction) {
    monthLabel.textContent = `${monthNames[viewMonth]} ${viewYear}`;
    grid.innerHTML = "";

    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startDow = firstOfMonth.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const cells = [];

    for (let i = startDow - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const m = viewMonth === 0 ? 11 : viewMonth - 1;
      const y = viewMonth === 0 ? viewYear - 1 : viewYear;
      cells.push({ y, m, d, outside: true });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ y: viewYear, m: viewMonth, d, outside: false });
    }
    let trail = 1;
    while (cells.length % 7 !== 0) {
      const m = viewMonth === 11 ? 0 : viewMonth + 1;
      const y = viewMonth === 11 ? viewYear + 1 : viewYear;
      cells.push({ y, m, d: trail++, outside: true });
    }

    const isToday = (y, m, d) =>
      y === today.getFullYear() && m === today.getMonth() && d === today.getDate();

    cells.forEach((c) => {
      const key = toKey(c.y, c.m, c.d);
      const dayEvents = events[key] || [];

      const cell = document.createElement("div");
      cell.className = "day-cell";
      cell.dataset.key = key;
      if (c.outside) cell.classList.add("outside");
      if (isToday(c.y, c.m, c.d)) cell.classList.add("today");
      if (dayEvents.length) cell.classList.add("has-events");

      const num = document.createElement("div");
      num.className = "day-num";
      num.textContent = c.d;
      cell.appendChild(num);

      if (dayEvents.length) {
        const list = document.createElement("div");
        list.className = "day-events";
        const shown = dayEvents.slice(0, 2);
        shown.forEach((ev) => {
          const chip = document.createElement("div");
          chip.className = "event-chip";
          const span = document.createElement("span");
          span.textContent = ev.title;
          chip.appendChild(span);
          list.appendChild(chip);
        });
        if (dayEvents.length > shown.length) {
          const more = document.createElement("div");
          more.className = "event-more";
          more.textContent = `+${dayEvents.length - shown.length} more`;
          list.appendChild(more);
        }
        cell.appendChild(list);
      }

      cell.addEventListener("click", () => openModal(c.y, c.m, c.d));
      grid.appendChild(cell);
    });

    if (direction) {
      grid.style.setProperty("--turn-dir", direction > 0 ? "10px" : "-10px");
      grid.classList.remove("turning");
      void grid.offsetWidth;
      grid.classList.add("turning");
    }
  }

  function flashCell(dateKey) {
    const cell = grid.querySelector(`.day-cell[data-key="${dateKey}"]`);
    if (!cell) return;
    cell.classList.remove("just-added");
    void cell.offsetWidth; // restart animation
    cell.classList.add("just-added");
  }

  /* ============ Upcoming agenda ============ */
  const upcomingList = document.getElementById("upcomingList");

  function renderUpcoming() {
    const todayKey = toKey(today.getFullYear(), today.getMonth(), today.getDate());
    const items = [];
    for (const dateKey of Object.keys(events)) {
      if (dateKey < todayKey) continue;
      for (const ev of events[dateKey]) {
        items.push({ dateKey, ...ev });
      }
    }
    items.sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
      return (a.time || "99:99").localeCompare(b.time || "99:99");
    });

    upcomingList.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "upcoming-empty";
      empty.textContent = "Nothing coming up";
      upcomingList.appendChild(empty);
      return;
    }

    items.slice(0, 6).forEach((ev) => {
      const [y, m, d] = ev.dateKey.split("-").map(Number);
      const item = document.createElement("div");
      item.className = "upcoming-item";
      const isToday = ev.dateKey === todayKey;
      item.innerHTML = `
        <div class="upcoming-date">${isToday ? "Today" : `${monthNames[m - 1].slice(0, 3)} ${d}`}</div>
        <div class="upcoming-info">
          <div class="upcoming-title"></div>
          <div class="upcoming-time"></div>
        </div>
      `;
      item.querySelector(".upcoming-title").textContent = ev.title;
      item.querySelector(".upcoming-time").textContent = fmtTime(ev.time);
      item.addEventListener("click", () => {
        viewYear = y; viewMonth = m - 1;
        renderCalendar();
        openModal(y, m - 1, d);
      });
      upcomingList.appendChild(item);
    });
  }

  /* ============ Modal ============ */
  const modalOverlay = document.getElementById("modalOverlay");
  const modalDate = document.getElementById("modalDate");
  const modalEventList = document.getElementById("modalEventList");
  const modalAddForm = document.getElementById("modalAddForm");
  const modalEventTitle = document.getElementById("modalEventTitle");
  const modalEventTime = document.getElementById("modalEventTime");
  const modalClose = document.getElementById("modalClose");

  function openModal(y, m, d) {
    selectedDateStr = toKey(y, m, d);
    modalDate.textContent = fmtDateLong(y, m, d);
    renderModalEvents();
    modalOverlay.classList.remove("hidden");
    modalEventTitle.value = "";
    modalEventTime.value = "";
    modalEventTitle.focus();
  }

  function closeModal() {
    modalOverlay.classList.add("hidden");
    selectedDateStr = null;
  }

  function renderModalEvents() {
    modalEventList.innerHTML = "";
    const list = events[selectedDateStr] || [];
    list.forEach((ev) => {
      const item = document.createElement("div");
      item.className = "modal-event-item";
      item.innerHTML = `
        <span class="dot"></span>
        <div class="info">
          <div class="title"></div>
          <div class="time"></div>
        </div>
        <button class="del" aria-label="Delete">&times;</button>
      `;
      item.querySelector(".title").textContent = ev.title;
      item.querySelector(".time").textContent = fmtTime(ev.time);
      item.querySelector(".del").addEventListener("click", () => {
        deleteEvent(selectedDateStr, ev.id);
        renderModalEvents();
        renderCalendar();
        renderUpcoming();
      });
      modalEventList.appendChild(item);
    });
  }

  modalClose.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalOverlay.classList.contains("hidden")) closeModal();
  });

  modalAddForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = modalEventTitle.value.trim();
    if (!title || !selectedDateStr) return;
    addEvent(selectedDateStr, title, modalEventTime.value || null);
    renderModalEvents();
    renderCalendar();
    renderUpcoming();
    flashCell(selectedDateStr);
    modalEventTitle.value = "";
    modalEventTime.value = "";
    modalEventTitle.focus();
  });

  /* ============ Quick add (natural language) ============ */
  const quickAddForm = document.getElementById("quickAddForm");
  const quickAddInput = document.getElementById("quickAddInput");

  quickAddForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = quickAddInput.value.trim();
    if (!raw) return;

    pushChat(`<b>You:</b> ${escapeHtml(raw)}`);

    const parsed = parseEventMessage(raw);
    if (!parsed) {
      pushChat("Sorry, I couldn't understand that.", "err");
      quickAddInput.value = "";
      return;
    }

    addEvent(parsed.dateKey, parsed.title, parsed.time);
    if (selectedDateStr === parsed.dateKey) renderModalEvents();

    if (!parsed.dateFound) {
      pushChat(
        `Couldn't find a date in that, so I used <b>today</b>. Try wording it like "Sept 3", "tomorrow", or "next friday".`,
        "err"
      );
    }
    pushChat(
      `Added <b>${escapeHtml(parsed.title)}</b><div class="meta">${parsed.dateLabel} &middot; ${fmtTime(parsed.time)}</div>`,
      "ok"
    );

    const [yy, mm] = parsed.dateKey.split("-").map(Number);
    const changedMonth = yy !== viewYear || mm - 1 !== viewMonth;
    viewYear = yy; viewMonth = mm - 1;
    renderCalendar(changedMonth ? 1 : 0);
    renderUpcoming();
    flashCell(parsed.dateKey);

    quickAddInput.value = "";
  });

  /* ============ Weekly schedule (recurring, edit via prompt) ============ */
  const weeklyScheduleEl = document.getElementById("weeklySchedule");

  function renderWeekly() {
    weeklyScheduleEl.innerHTML = "";
    for (let dow = 0; dow < 7; dow++) {
      const row = document.createElement("div");
      row.className = "weekly-row";
      const text = weekly[dow] || "";
      row.innerHTML = `
        <span class="weekly-day">${weekdayAbbr[dow].charAt(0).toUpperCase() + weekdayAbbr[dow].slice(1)}</span>
        <span class="weekly-text ${text ? "" : "empty"}">${escapeHtml(text || "Nothing scheduled")}</span>
      `;
      row.addEventListener("click", () => {
        const input = prompt(`${weekdayNames[dow]} schedule:`, text);
        if (input === null) return;
        const trimmed = input.trim();
        if (trimmed) {
          weekly[dow] = trimmed;
        } else {
          delete weekly[dow];
        }
        writeData();
        renderWeekly();
      });
      weeklyScheduleEl.appendChild(row);
    }
  }

  /* ============ Nav ============ */
  function goToPrevMonth() {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar(-1);
  }
  function goToNextMonth() {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar(1);
  }
  document.getElementById("prevBtn").addEventListener("click", goToPrevMonth);
  document.getElementById("nextBtn").addEventListener("click", goToNextMonth);
  document.getElementById("todayBtn").addEventListener("click", () => {
    const changed = viewYear !== today.getFullYear() || viewMonth !== today.getMonth();
    viewYear = today.getFullYear();
    viewMonth = today.getMonth();
    renderCalendar(changed ? 1 : 0);
  });

  /* ============ Swipe to change month (touch) ============ */
  const calendarBody = document.getElementById("calendarBody");
  let touchStartX = null, touchStartY = null;
  calendarBody.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  calendarBody.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    touchStartX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) goToNextMonth(); else goToPrevMonth();
    }
  }, { passive: true });

  /* ============ Theme ============ */
  const themeToggle = document.getElementById("themeToggle");
  function applyTheme(t) {
    if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
  }
  let currentTheme = localStorage.getItem(THEME_KEY) ||
    (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(currentTheme);
  themeToggle.addEventListener("click", () => {
    currentTheme = currentTheme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, currentTheme);
    applyTheme(currentTheme);
  });

  /* ============ Auth ============ */
  const loginScreen = document.getElementById("loginScreen");
  const appRoot = document.getElementById("appRoot");
  const loginForm = document.getElementById("loginForm");
  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const loginError = document.getElementById("loginError");
  const signOutBtn = document.getElementById("signOutBtn");

  function showApp() {
    loginScreen.classList.add("hidden");
    appRoot.classList.remove("hidden");
  }
  function showLogin() {
    appRoot.classList.add("hidden");
    loginScreen.classList.remove("hidden");
    loginPassword.value = "";
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";
    try {
      await signInWithEmailAndPassword(auth, loginEmail.value.trim(), loginPassword.value);
    } catch (err) {
      loginError.textContent = "Sign-in failed — check your email and password.";
    }
  });

  signOutBtn.addEventListener("click", () => signOut(auth));

  if (auth) {
    onAuthStateChanged(auth, (user) => {
      if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
      if (user) {
        showApp();
        renderCalendar();
        renderWeekly();
        renderUpcoming();
        listenToData(user.uid);
      } else {
        showLogin();
      }
    });
  } else {
    loginError.textContent = "Firebase isn't configured yet — edit firebase-config.js.";
  }
})();
