

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
    renderCalendar();
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
    viewYear = yy; viewMonth = mm - 1;
    renderCalendar();

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
  document.getElementById("prevBtn").addEventListener("click", () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar();
  });
  document.getElementById("nextBtn").addEventListener("click", () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
  });
  document.getElementById("todayBtn").addEventListener("click", () => {
    viewYear = today.getFullYear();
    viewMonth = today.getMonth();
    renderCalendar();
  });

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
        listenToData(user.uid);
      } else {
        showLogin();
      }
    });
  } else {
    loginError.textContent = "Firebase isn't configured yet — edit firebase-config.js.";
  }
})();
