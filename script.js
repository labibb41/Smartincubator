// ==================== FIREBASE CONFIG ====================
const firebaseConfig = {
    apiKey: "AIzaSyAQe__wZ1_xjW6dLjWTCgKDamN5EnT5mjc",
    databaseURL: "https://smart-incubator-d53d4-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ==================== STATE ====================
let currentMode = "manual";
let currentPlant = null;
let espOffline = false;
let lastSeenTime = 0;
let lastSensorTime = Date.now();
let plantsList = {};
let editingPlantId = null;
let scheduleTimes = ["08:00", "15:00"];
let customScheduleTimes = ["08:00", "15:00"];
let countdownInterval = null;
let sprayerEndTime = null;
let autoSchedulerInterval = null;
let lastAutoSprayMinuteKey = null;
let deviceState = { fan: false, sprayer: false, lamp: false };
let activePlantClosed = false;

// ==================== DOM READY ====================
document.addEventListener("DOMContentLoaded", function () {
    initUI();
    initFirebaseListeners();
    initEventListeners();
    startAutoScheduler();
    updateTime();
    setInterval(updateTime, 1000);
    setInterval(checkESPConnection, 5000);
});

function initUI() {
    document.getElementById("minTemp").value = 26;
    document.getElementById("maxTemp").value = 33;
    document.getElementById("sprayerDurasi").value = 5;
    document.getElementById("sprayerStartDate").value = todayDate();
    document.getElementById("customStartDate").value = todayDate();

    const brightnessSlider = document.getElementById("brightnessSlider");
    const brightnessValue = document.getElementById("brightnessValue");
    if (brightnessSlider && brightnessValue) {
        brightnessSlider.value = 60;
        brightnessValue.textContent = "60%";
    }

    renderScheduleList(scheduleTimes);
    renderCustomScheduleList(customScheduleTimes);
    renderActivePlantOverview();
}

function initFirebaseListeners() {
    db.ref(".info/connected").on("value", (snapshot) => updateConnectionStatus(snapshot.val()));

    db.ref("/device/inkubator_1/mode").on("value", (snapshot) => {
        const mode = snapshot.val();
        if (!mode) return;
        currentMode = mode;
        updateModeUI(mode);
        renderActivePlantOverview();
    });

    db.ref("/device/inkubator_1/sensor/temperature").on("value", (snapshot) => {
        const suhu = snapshot.val();
        if (suhu === null) return;
        lastSensorTime = Date.now();
        updateTemperatureUI(suhu);
        if (currentPlant) updatePlantStatusIndicators();
    });

    db.ref("/device/inkubator_1/sensor/humidity").on("value", (snapshot) => {
        const hum = snapshot.val();
        if (hum === null) return;
        lastSensorTime = Date.now();
        updateHumidityUI(hum);
        if (currentPlant) updatePlantStatusIndicators();
    });

    db.ref("/device/inkubator_1/relay/fan").on("value", (snapshot) => {
        deviceState.fan = snapshot.val() === true;
        updateRelayUI("kipas", deviceState.fan ? 1 : 0);
        renderActivePlantOverview();
    });

    db.ref("/device/inkubator_1/relay/sprayer").on("value", (snapshot) => {
        deviceState.sprayer = snapshot.val() === true;
        updateRelayUI("sprayer", deviceState.sprayer ? 1 : 0);
        renderActivePlantOverview();
    });

    db.ref("/device/inkubator_1/relay/lamp").on("value", (snapshot) => {
        deviceState.lamp = snapshot.val() === true;
        const status = deviceState.lamp ? 1 : 0;
        updateLampuRelayUI(status);
        updateLampPWMStatus();
        renderActivePlantOverview();
    });

    db.ref("/device/inkubator_1/lamp_pwm").on("value", (snapshot) => {
        const brightness = snapshot.val();
        if (brightness !== null) updateBrightnessUI(brightness);
    });

    db.ref("/device/inkubator_1/manual/sprayer_times").on("value", (snapshot) => {
        const times = snapshot.val();
        if (times && Array.isArray(times)) {
            scheduleTimes = normalizeTimes(times);
            renderScheduleList(scheduleTimes);
        }
    });

    db.ref("/device/inkubator_1/manual/sprayer_duration").on("value", (snapshot) => {
        const durasi = snapshot.val();
        if (durasi !== null) document.getElementById("sprayerDurasi").value = durasi;
    });

    db.ref("/device/inkubator_1/manual/sprayer_start_date").on("value", (snapshot) => {
        const startDate = snapshot.val();
        if (startDate) document.getElementById("sprayerStartDate").value = startDate;
    });

    db.ref("/device/inkubator_1/last_seen").on("value", (snapshot) => {
        const ts = snapshot.val();
        if (ts === null) {
            lastSeenTime = 0;
            return;
        }
        lastSeenTime = ts;
        const now = Math.floor(Date.now() / 1000);
        updateESPStatus(now - ts <= 20);
    });

    db.ref("/plants").on("value", (snapshot) => {
        plantsList = snapshot.val() || {};
        renderPlantButtons();
        db.ref("/device/inkubator_1/active_plant").once("value", (plantSnap) => {
            const activeId = plantSnap.val();
            if (activeId && plantsList[activeId]) selectPlantById(activeId);
            else renderActivePlantOverview();
        });
    });

}

function renderPlantButtons() {
    const container = document.querySelector(".plant-options");
    if (!container) return;
    container.innerHTML = "";

    for (const [id, plant] of Object.entries(plantsList)) {
        const btn = document.createElement("button");
        btn.className = "plant-btn";
        btn.dataset.plantId = id;
        btn.innerHTML = `<i class="fas fa-seedling"></i><span>${plant.name || "Tanaman"}</span>`;
        btn.addEventListener("click", () => selectPlantById(id));
        container.appendChild(btn);
    }

    const customBtn = document.createElement("button");
    customBtn.className = "plant-btn";
    customBtn.dataset.plantId = "custom";
    customBtn.innerHTML = '<i class="fas fa-plus"></i><span>Custom</span>';
    customBtn.addEventListener("click", showCustomPlantForm);
    container.appendChild(customBtn);
}

function selectPlantById(plantId) {
    if (plantId === "custom") {
        showCustomPlantForm();
        return;
    }

    const plant = plantsList[plantId];
    if (!plant) return;

    const times = normalizeTimes(plant.watering?.times || ["08:00", "15:00"]);
    currentPlant = {
        id: plantId,
        name: plant.name,
        tempMin: plant.temp_optimal?.min || 20,
        tempMax: plant.temp_optimal?.max || 30,
        lightPWM: plant.light_pwm || 60,
        wateringDuration: plant.watering?.duration || 10,
        wateringTimes: times,
        wateringStartDate: plant.watering?.start_date || todayDate(),
        auto: plant.auto !== false
    };

    updatePlantInfo(currentPlant);
    activePlantClosed = false;
    db.ref("/device/inkubator_1/active_plant").set(plantId);

    document.querySelectorAll(".plant-btn").forEach(btn => btn.classList.remove("active"));
    const activeBtn = Array.from(document.querySelectorAll(".plant-btn")).find(btn => btn.dataset.plantId === plantId);
    if (activeBtn) activeBtn.classList.add("active");

    scheduleTimes = [...currentPlant.wateringTimes];
    renderScheduleList(scheduleTimes);
    document.getElementById("sprayerDurasi").value = currentPlant.wateringDuration;
    document.getElementById("sprayerStartDate").value = currentPlant.wateringStartDate || todayDate();

    hideCustomPlantForm();
    showPlantActions();
    renderActivePlantOverview();
}

function updatePlantInfo(plant) {
    document.querySelector(".plant-name").textContent = plant.name;
    document.querySelector(".plant-status").textContent = `Aktif mulai ${formatDate(plant.wateringStartDate)} | ${plant.wateringTimes.join(", ")}`;
    document.getElementById("tempRequirement").textContent = `${plant.tempMin}C - ${plant.tempMax}C`;
    document.getElementById("tempReqRange").textContent = `Min: ${plant.tempMin}C, Max: ${plant.tempMax}C`;
    const midTemp = (plant.tempMin + plant.tempMax) / 2;
    document.getElementById("tempReqFill").style.width = (midTemp / 50 * 100) + "%";

    document.getElementById("humidityRequirement").textContent = "60%";
    document.getElementById("humidityReqRange").textContent = "Optimal: 60%";
    document.getElementById("humidityReqFill").style.width = "60%";
}

function showPlantActions() { document.getElementById("plantActions").style.display = "flex"; }
function hidePlantActions() { document.getElementById("plantActions").style.display = "none"; }

function showCustomPlantForm() {
    editingPlantId = null;
    document.querySelector("#plantCustomForm .custom-title").textContent = "Tanaman Custom";
    document.getElementById("saveCustomBtn").innerHTML = '<i class="fas fa-save"></i> Simpan Tanaman';
    document.getElementById("customName").value = "";
    document.getElementById("customMinTemp").value = "20";
    document.getElementById("customMaxTemp").value = "30";
    document.getElementById("customLightPWM").value = "60";
    document.getElementById("customLightValue").textContent = "60%";
    document.getElementById("customDuration").value = "10";
    document.getElementById("customAuto").checked = true;
    document.getElementById("customStartDate").value = todayDate();
    customScheduleTimes = ["08:00", "15:00"];
    renderCustomScheduleList(customScheduleTimes);
    document.getElementById("plantCustomForm").style.display = "block";
    hidePlantActions();
}

function hideCustomPlantForm() { document.getElementById("plantCustomForm").style.display = "none"; }

function saveCustomPlant() {
    const name = document.getElementById("customName").value.trim();
    const minTemp = parseInt(document.getElementById("customMinTemp").value, 10);
    const maxTemp = parseInt(document.getElementById("customMaxTemp").value, 10);
    const lightPWM = parseInt(document.getElementById("customLightPWM").value, 10);
    const duration = parseInt(document.getElementById("customDuration").value, 10);
    const auto = document.getElementById("customAuto").checked;
    const startDate = document.getElementById("customStartDate").value;
    const times = getCustomScheduleTimes();

    if (!name) return showTemporaryNotification("Masukkan nama tanaman!", "error");
    if (minTemp >= maxTemp) return showTemporaryNotification("Suhu minimum harus kurang dari maksimum!", "error");
    if (duration < 1 || duration > 60) return showTemporaryNotification("Durasi harus 1-60 detik!", "error");
    if (!startDate) return showTemporaryNotification("Pilih tanggal mulai penyiraman!", "error");
    if (times.length === 0) return showTemporaryNotification("Tambahkan minimal 1 jam penyiraman!", "error");

    const plantData = {
        name,
        auto,
        light_kelvin: 6500,
        light_pwm: lightPWM,
        par_target: 200,
        temp_optimal: { min: minTemp, max: maxTemp },
        watering: { duration, start_date: startDate, times }
    };

    if (editingPlantId) {
        const updateId = editingPlantId;
        return db.ref("/plants/" + updateId).update(plantData)
            .then(() => {
                showTemporaryNotification("Tanaman berhasil diperbarui!", "success");
                editingPlantId = null;
                hideCustomPlantForm();
                selectPlantById(updateId);
            })
            .catch(() => showTemporaryNotification("Gagal memperbarui tanaman!", "error"));
    }

    const plantId = "plant_" + Date.now();
    db.ref("/plants/" + plantId).set(plantData)
        .then(() => {
            showTemporaryNotification("Tanaman berhasil disimpan!", "success");
            cancelCustomPlant();
        })
        .catch(() => showTemporaryNotification("Gagal menyimpan tanaman!", "error"));
}

function cancelCustomPlant() {
    hideCustomPlantForm();
    editingPlantId = null;
    db.ref("/device/inkubator_1/active_plant").once("value", (snap) => {
        const activeId = snap.val();
        if (activeId && plantsList[activeId]) selectPlantById(activeId);
        else resetPlantInfo();
    });
}

function applyPlantSettings() {
    if (!currentPlant) return showToast("Tidak ada tanaman yang dipilih", "warning");

    document.getElementById("minTemp").value = currentPlant.tempMin;
    document.getElementById("maxTemp").value = currentPlant.tempMax;
    updateTempRange();

    scheduleTimes = [...currentPlant.wateringTimes];
    renderScheduleList(scheduleTimes);
    document.getElementById("sprayerDurasi").value = currentPlant.wateringDuration;
    document.getElementById("sprayerStartDate").value = currentPlant.wateringStartDate || todayDate();

    const payload = {
        active_plant_id: currentPlant.id,
        start_date: currentPlant.wateringStartDate || todayDate(),
        times: scheduleTimes,
        duration: currentPlant.wateringDuration
    };

    Promise.all([
        db.ref("/device/inkubator_1/lamp_pwm").set(currentPlant.lightPWM),
        db.ref("/device/inkubator_1/manual/sprayer_times").set(scheduleTimes),
        db.ref("/device/inkubator_1/manual/sprayer_duration").set(currentPlant.wateringDuration),
        db.ref("/device/inkubator_1/manual/sprayer_start_date").set(payload.start_date),
        db.ref("/device/inkubator_1/auto_schedule").set(payload)
    ]).then(() => {
        saveAppliedPlantHistory(currentPlant);
        pushSystemLog("apply_plant_settings", { plantName: currentPlant.name, times: scheduleTimes.join(", "), startDate: payload.start_date });
        activePlantClosed = false;
        renderActivePlantOverview();
        showTemporaryNotification(`Pengaturan ${currentPlant.name} diterapkan`, "success");
    }).catch(() => showTemporaryNotification("Gagal menerapkan pengaturan tanaman", "error"));
}

function removeCurrentPlant() {
    if (!currentPlant || !currentPlant.id) return;
    if (!confirm(`Hapus tanaman ${currentPlant.name}?`)) return;
    const removedName = currentPlant.name;

    db.ref("/plants/" + currentPlant.id).remove()
        .then(() => {
            showTemporaryNotification("Tanaman dihapus", "success");
            resetPlantInfo();
            db.ref("/device/inkubator_1/active_plant").set("");
            pushSystemLog("remove_plant", { plantName: removedName });
            renderActivePlantOverview();
        })
        .catch(() => showTemporaryNotification("Gagal menghapus", "error"));
}

function resetPlantInfo() {
    currentPlant = null;
    document.querySelector(".plant-name").textContent = "Belum ada tanaman";
    document.querySelector(".plant-status").textContent = "Pilih tanaman untuk melihat kebutuhan";
    document.getElementById("tempRequirement").textContent = "--C";
    document.getElementById("tempReqRange").textContent = "Min: --C, Max: --C";
    document.getElementById("tempReqFill").style.width = "0%";
    document.getElementById("humidityRequirement").textContent = "--%";
    document.getElementById("humidityReqRange").textContent = "Optimal: --%";
    document.getElementById("humidityReqFill").style.width = "0%";
    hidePlantActions();
    hideCustomPlantForm();
    document.querySelectorAll(".plant-btn").forEach(btn => btn.classList.remove("active"));
    renderActivePlantOverview();
}

function editPlant() {
    if (!currentPlant || !currentPlant.id) return;

    document.getElementById("customName").value = currentPlant.name;
    document.getElementById("customMinTemp").value = currentPlant.tempMin;
    document.getElementById("customMaxTemp").value = currentPlant.tempMax;
    document.getElementById("customLightPWM").value = currentPlant.lightPWM;
    document.getElementById("customLightValue").textContent = currentPlant.lightPWM + "%";
    document.getElementById("customDuration").value = currentPlant.wateringDuration;
    document.getElementById("customAuto").checked = currentPlant.auto;
    document.getElementById("customStartDate").value = currentPlant.wateringStartDate || todayDate();
    customScheduleTimes = normalizeTimes(currentPlant.wateringTimes || []);
    renderCustomScheduleList(customScheduleTimes);

    editingPlantId = currentPlant.id;
    document.querySelector("#plantCustomForm .custom-title").textContent = "Edit Tanaman";
    document.getElementById("saveCustomBtn").innerHTML = '<i class="fas fa-save"></i> Update Tanaman';
    hidePlantActions();
    document.getElementById("plantCustomForm").style.display = "block";
}

function renderScheduleList(times) {
    const container = document.getElementById("scheduleList");
    if (!container) return;
    container.innerHTML = "";

    if (!times || times.length === 0) {
        container.innerHTML = '<p style="color: #81c784; text-align: center;">Belum ada jadwal. Tambah jadwal baru.</p>';
        return;
    }

    times.forEach((time, index) => {
        const item = document.createElement("div");
        item.className = "schedule-time-item";
        item.innerHTML = `<input type="time" class="schedule-time-input" data-index="${index}" value="${time}"><button class="remove-time" data-index="${index}"><i class="fas fa-times"></i></button>`;
        container.appendChild(item);
    });

    document.querySelectorAll(".schedule-time-input").forEach(input => {
        input.addEventListener("change", function () {
            const idx = parseInt(this.dataset.index, 10);
            scheduleTimes[idx] = this.value;
        });
    });

    document.querySelectorAll(".remove-time").forEach(btn => {
        btn.addEventListener("click", function () {
            const idx = parseInt(this.dataset.index, 10);
            scheduleTimes.splice(idx, 1);
            renderScheduleList(scheduleTimes);
        });
    });
}

function renderCustomScheduleList(times) {
    const container = document.getElementById("customScheduleList");
    if (!container) return;
    container.innerHTML = "";

    if (!times || times.length === 0) {
        container.innerHTML = '<p style="color: #81c784; text-align: center;">Belum ada jam penyiraman.</p>';
        return;
    }

    times.forEach((time, index) => {
        const item = document.createElement("div");
        item.className = "schedule-time-item";
        item.innerHTML = `<input type="time" class="custom-schedule-time-input" data-index="${index}" value="${time}"><button type="button" class="remove-custom-time" data-index="${index}"><i class="fas fa-times"></i></button>`;
        container.appendChild(item);
    });

    document.querySelectorAll(".custom-schedule-time-input").forEach(input => {
        input.addEventListener("change", function () {
            const idx = parseInt(this.dataset.index, 10);
            customScheduleTimes[idx] = this.value;
        });
    });

    document.querySelectorAll(".remove-custom-time").forEach(btn => {
        btn.addEventListener("click", function () {
            const idx = parseInt(this.dataset.index, 10);
            customScheduleTimes.splice(idx, 1);
            renderCustomScheduleList(customScheduleTimes);
        });
    });
}

function getCustomScheduleTimes() { return normalizeTimes(customScheduleTimes); }
function normalizeTimes(times) {
    const filtered = (times || []).filter(t => typeof t === "string" && t.trim() !== "");
    const uniq = [...new Set(filtered)];
    return uniq.sort();
}

function saveSprayerSchedule() {
    const durasi = parseInt(document.getElementById("sprayerDurasi").value, 10);
    const startDate = document.getElementById("sprayerStartDate").value;
    const validTimes = normalizeTimes(scheduleTimes);

    if (durasi < 1 || durasi > 60) return showTemporaryNotification("Durasi harus 1-60 detik!", "error");
    if (!startDate) return showTemporaryNotification("Pilih tanggal mulai penyiraman!", "error");
    if (validTimes.length === 0) return showTemporaryNotification("Setidaknya satu jadwal harus diisi!", "error");

    scheduleTimes = validTimes;
    renderScheduleList(scheduleTimes);

    Promise.all([
        db.ref("/device/inkubator_1/manual/sprayer_times").set(scheduleTimes),
        db.ref("/device/inkubator_1/manual/sprayer_duration").set(durasi),
        db.ref("/device/inkubator_1/manual/sprayer_start_date").set(startDate)
    ]).then(() => {
        pushSystemLog("save_sprayer_schedule", { startDate, duration: durasi, times: scheduleTimes.join(", ") });
        showTemporaryNotification("Jadwal sprayer tersimpan!", "success");
    }).catch(() => showTemporaryNotification("Gagal menyimpan jadwal!", "error"));
}

function initEventListeners() {
    document.getElementById("autoModeBtn").addEventListener("click", () => setMode("auto"));
    document.getElementById("manualModeBtn").addEventListener("click", () => setMode("manual"));

    document.getElementById("kipasToggle").addEventListener("change", (e) => currentMode === "manual" ? setRelay("fan", e.target.checked) : rollbackToggle(e));
    document.getElementById("sprayerToggle").addEventListener("change", (e) => currentMode === "manual" ? setRelay("sprayer", e.target.checked) : rollbackToggle(e));
    document.getElementById("lampuRelayToggle").addEventListener("change", (e) => currentMode === "manual" ? setRelay("lamp", e.target.checked) : rollbackToggle(e));
    document.getElementById("lampPWMToggle").addEventListener("change", (e) => currentMode === "manual" ? setRelay("lamp", e.target.checked) : rollbackToggle(e));

    const brightnessSlider = document.getElementById("brightnessSlider");
    const brightnessValue = document.getElementById("brightnessValue");
    brightnessSlider.addEventListener("input", (e) => brightnessValue.textContent = e.target.value + "%");
    brightnessSlider.addEventListener("change", (e) => {
        if (currentMode !== "manual") return showToast("Mode Auto aktif! Ganti ke Manual dulu.", "warning");
        const brightness = parseInt(e.target.value, 10);
        db.ref("/device/inkubator_1/lamp_pwm").set(brightness);
        pushSystemLog("set_lamp_brightness", { brightness: brightness + "%" });
        showTemporaryNotification(`Kecerahan lampu: ${brightness}%`, "success");
    });

    document.getElementById("saveSetpointBtn").addEventListener("click", () => showToast("Setpoint suhu mengikuti tanaman yang dipilih", "info"));
    document.getElementById("saveSprayerBtn").addEventListener("click", saveSprayerSchedule);
    document.getElementById("addScheduleBtn").addEventListener("click", () => { scheduleTimes.push("12:00"); renderScheduleList(scheduleTimes); });
    document.getElementById("customAddScheduleBtn").addEventListener("click", () => { customScheduleTimes.push("12:00"); renderCustomScheduleList(customScheduleTimes); });

    document.getElementById("closeBanner")?.addEventListener("click", hideBanner);
    document.getElementById("cancelCustomBtn").addEventListener("click", cancelCustomPlant);
    document.getElementById("saveCustomBtn").addEventListener("click", saveCustomPlant);
    document.getElementById("applySettingsBtn").addEventListener("click", () => currentPlant ? applyPlantSettings() : showToast("Pilih tanaman terlebih dahulu", "warning"));
    document.getElementById("removePlantBtn").addEventListener("click", removeCurrentPlant);
    document.getElementById("editPlantBtn").addEventListener("click", editPlant);
    document.getElementById("finishActivePlantBtn")?.addEventListener("click", finishActivePlant);

    const customLight = document.getElementById("customLightPWM");
    const customLightVal = document.getElementById("customLightValue");
    if (customLight && customLightVal) customLight.addEventListener("input", (e) => customLightVal.textContent = e.target.value + "%");
}

function rollbackToggle(e) {
    e.target.checked = !e.target.checked;
    showToast("Mode Auto aktif! Ganti ke Manual dulu.", "warning");
}

function setMode(mode) {
    db.ref("/device/inkubator_1/mode").set(mode)
        .then(() => { pushSystemLog("change_mode", { mode: mode.toUpperCase() }); showTemporaryNotification(`Mode diubah ke ${mode.toUpperCase()}`, "success"); })
        .catch(() => showTemporaryNotification("Gagal mengubah mode!", "error"));
}

function setRelay(relay, value) {
    db.ref("/device/inkubator_1/relay/" + relay).set(value)
        .then(() => { pushSystemLog("relay_control", { relay, state: value ? "ON" : "OFF" }); showTemporaryNotification(`Relay ${relay} ${value ? "ON" : "OFF"}`, "success"); })
        .catch(() => showTemporaryNotification(`Gagal mengontrol ${relay}!`, "error"));
}

function startAutoScheduler() {
    if (autoSchedulerInterval) clearInterval(autoSchedulerInterval);
    runAutoSchedulerTick();
    autoSchedulerInterval = setInterval(runAutoSchedulerTick, 15000);
}

function runAutoSchedulerTick() {
    if (currentMode !== "auto" || !currentPlant) return;
    const startDate = currentPlant.wateringStartDate || document.getElementById("sprayerStartDate").value;
    if (!startDate || todayDate() < startDate) return;

    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const times = normalizeTimes(currentPlant.wateringTimes || []);
    if (!times.includes(currentTime)) return;

    const minuteKey = `${todayDate()}_${currentPlant.id}_${currentTime}`;
    if (lastAutoSprayMinuteKey === minuteKey) return;
    lastAutoSprayMinuteKey = minuteKey;
    triggerAutoSprayer(currentPlant.wateringDuration || 5, currentPlant.name, currentTime);
}

function triggerAutoSprayer(duration, plantName, scheduleTime) {
    db.ref("/device/inkubator_1/relay/sprayer").set(true)
        .then(() => {
            pushSystemLog("auto_sprayer_triggered", { plantName, triggerTime: scheduleTime, duration: `${duration}s` });
            setTimeout(() => db.ref("/device/inkubator_1/relay/sprayer").set(false), duration * 1000);
        })
        .catch(() => showTemporaryNotification("Gagal trigger sprayer otomatis", "error"));
}

function updateTemperatureUI(suhu) {
    document.getElementById("temperatureValue").textContent = suhu.toFixed(1);
    document.getElementById("tempProgress").style.width = Math.min((suhu / 50) * 100, 100) + "%";
}

function updateHumidityUI(hum) {
    document.getElementById("humidityValue").textContent = hum.toFixed(1);
    document.getElementById("humProgress").style.width = hum + "%";
}

function updateRelayUI(relay, status) {
    const stateEl = document.getElementById(relay + "Status");
    const toggleEl = document.getElementById(relay + "Toggle");
    if (stateEl) {
        stateEl.textContent = status === 1 ? "ON" : "OFF";
        stateEl.style.color = status === 1 ? "#4caf50" : "#ff5252";
    }
    if (toggleEl) toggleEl.checked = status === 1;

    if (relay === "sprayer") {
        if (status === 1) {
            const duration = currentMode === "manual" ? (parseInt(document.getElementById("sprayerDurasi").value, 10) || 5) : (currentPlant?.wateringDuration || 5);
            startSprayerCountdown(duration);
        } else stopSprayerCountdown();
    }
}

function updateLampuRelayUI(status) {
    const stateEl = document.getElementById("lampuRelayStatus");
    const toggleEl = document.getElementById("lampuRelayToggle");
    const pwmToggle = document.getElementById("lampPWMToggle");
    if (stateEl) {
        stateEl.textContent = status === 1 ? "ON" : "OFF";
        stateEl.style.color = status === 1 ? "#4caf50" : "#ff5252";
    }
    if (toggleEl) toggleEl.checked = status === 1;
    if (pwmToggle) pwmToggle.checked = status === 1;
}

function updateBrightnessUI(brightness) {
    document.getElementById("brightnessValue").textContent = brightness + "%";
    document.getElementById("brightnessSlider").value = brightness;
}

function updateLampPWMStatus() {
    db.ref("/device/inkubator_1/relay/lamp").once("value", (snap) => {
        const status = snap.val();
        const lampStatus = document.getElementById("lampPWMStatus");
        if (!lampStatus) return;
        lampStatus.textContent = status ? "ON" : "OFF";
        lampStatus.style.color = status ? "#4caf50" : "#ff5252";
    });
}

function updateModeUI(mode) {
    const autoBtn = document.getElementById("autoModeBtn");
    const manualBtn = document.getElementById("manualModeBtn");
    const modeBadge = document.getElementById("currentModeBadge");

    if (mode === "auto") {
        autoBtn.classList.add("active");
        manualBtn.classList.remove("active");
        modeBadge.textContent = "AUTO";
        modeBadge.style.background = "#4caf50";
    } else {
        autoBtn.classList.remove("active");
        manualBtn.classList.add("active");
        modeBadge.textContent = "MANUAL";
        modeBadge.style.background = "#9c27b0";
    }

    const isAuto = mode === "auto";
    ["kipasToggle", "sprayerToggle", "lampuRelayToggle", "lampPWMToggle", "brightnessSlider", "sprayerDurasi", "sprayerStartDate"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = isAuto;
    });
    document.querySelectorAll(".schedule-time-input, .remove-time").forEach(el => el.disabled = isAuto);
    const addBtn = document.getElementById("addScheduleBtn");
    if (addBtn) addBtn.disabled = isAuto;
}

function updateTempRange() {
    const min = document.getElementById("minTemp").value;
    const max = document.getElementById("maxTemp").value;
    document.getElementById("tempRange").textContent = min + "-" + max + "C";
}

function updateESPStatus(online) {
    const espStatus = document.getElementById("esp32Status");
    const wifiStatus = document.getElementById("wifiStatus");
    espOffline = !online;

    if (online) {
        espStatus.textContent = "Online";
        espStatus.className = "status-value online";
        wifiStatus.textContent = "Terhubung";
        wifiStatus.className = "status-value online";
        hideBanner();
    } else {
        espStatus.textContent = "Offline";
        espStatus.className = "status-value offline";
        wifiStatus.textContent = "Terputus";
        wifiStatus.className = "status-value offline";
        showBanner("ESP32 tidak terhubung! Periksa koneksi perangkat.", "error");
    }
}

function updateConnectionStatus(connected) {
    const connectionText = document.getElementById("connectionText");
    const connectionDot = document.getElementById("connectionDot");
    const firebaseStatus = document.getElementById("firebaseStatus");
    const streamStatus = document.getElementById("streamStatus");
    if (connected) {
        connectionText.textContent = "Terhubung ke Firebase";
        connectionDot.className = "status-dot connected";
        firebaseStatus.textContent = "Aktif";
        firebaseStatus.className = "status-value online";
        streamStatus.textContent = "Aktif";
        streamStatus.className = "status-value online";
    } else {
        connectionText.textContent = "Terputus dari Firebase";
        connectionDot.className = "status-dot";
        firebaseStatus.textContent = "Offline";
        firebaseStatus.className = "status-value offline";
        streamStatus.textContent = "Offline";
        streamStatus.className = "status-value offline";
    }
}

function updateTime() {
    const timeStr = new Date().toLocaleTimeString("id-ID");
    document.getElementById("sensorUpdateTime").textContent = timeStr;
    document.getElementById("lastUpdate").innerHTML = `<i class="fas fa-clock"></i><span>Terakhir update: ${timeStr}</span>`;
}

function updatePlantStatusIndicators() {
    if (!currentPlant) return;
}

function saveAppliedPlantHistory(plant) {
    db.ref("/device/inkubator_1/applied_plants_history").push({
        timestamp: Date.now(),
        date: todayDate(),
        plantId: plant.id,
        plantName: plant.name,
        startDate: plant.wateringStartDate || todayDate(),
        duration: plant.wateringDuration,
        times: plant.wateringTimes || []
    });
}

function pushSystemLog(action, details = {}) {
    db.ref("/device/inkubator_1/system_activity_logs").push({
        timestamp: Date.now(),
        date: todayDate(),
        action,
        details,
        mode: currentMode
    });
}

function renderActivePlantOverview() {
    const emptyEl = document.getElementById("activePlantEmpty");
    const contentEl = document.getElementById("activePlantContent");
    const titleEl = document.getElementById("activePlantTitle");
    const metaEl = document.getElementById("activePlantMeta");
    const settingsEl = document.getElementById("activePlantSettings");
    const systemsEl = document.getElementById("activePlantSystems");
    if (!emptyEl || !contentEl || !titleEl || !metaEl || !settingsEl || !systemsEl) return;

    if (!currentPlant || activePlantClosed) {
        contentEl.style.display = "none";
        emptyEl.style.display = "block";
        emptyEl.textContent = "Belum ada tumbuhan aktif.";
        return;
    }

    emptyEl.style.display = "none";
    contentEl.style.display = "block";
    titleEl.innerHTML = `<i class="fas fa-seedling"></i> ${currentPlant.name || "Tanaman Aktif"}`;
    metaEl.innerHTML = `<i class="fas fa-calendar-day"></i> Mulai ${formatDate(currentPlant.wateringStartDate)} <span style="margin:0 6px;">|</span> <i class="fas fa-clock"></i> ${(currentPlant.wateringTimes || []).join(", ")}`;

    const settings = [
        { icon: "fa-thermometer-half", text: `Suhu ${currentPlant.tempMin}C-${currentPlant.tempMax}C` },
        { icon: "fa-hourglass-half", text: `Durasi ${currentPlant.wateringDuration}s` },
        { icon: "fa-lightbulb", text: `Lampu ${currentPlant.lightPWM}%` },
        { icon: "fa-gear", text: `Mode ${String(currentMode).toUpperCase()}` },
    ];
    settingsEl.innerHTML = settings
        .map((x) => `<span class="active-plant-pill"><i class="fas ${x.icon}"></i>${x.text}</span>`)
        .join("");

    const systems = [
        { icon: "fa-wind", label: "Kipas", on: deviceState.fan },
        { icon: "fa-spray-can", label: "Sprayer", on: deviceState.sprayer },
        { icon: "fa-lightbulb", label: "Lampu", on: deviceState.lamp },
    ];
    systemsEl.innerHTML = systems
        .map((x) => `<span class="active-plant-pill ${x.on ? "on" : "off"}"><i class="fas ${x.icon}"></i>${x.label} ${x.on ? "ON" : "OFF"}</span>`)
        .join("");
}

function finishActivePlant() {
    if (!currentPlant) return;
    const finishedName = currentPlant.name;
    activePlantClosed = true;
    db.ref("/device/inkubator_1/active_plant").set("");
    pushSystemLog("finish_active_plant", { plantName: finishedName });
    renderActivePlantOverview();
    showTemporaryNotification(`Tumbuhan ${finishedName} selesai`, "success");
}

function summarizeDetails(details) {
    if (!details || typeof details !== "object") return "-";
    return Object.entries(details).map(([k, v]) => `${k}: ${v}`).join(" | ");
}

function showBanner(message, type = "error") {
    const banner = document.getElementById("notificationBanner");
    const bannerMessage = document.getElementById("bannerMessage");
    if (!banner || !bannerMessage) return;
    bannerMessage.textContent = message;
    banner.className = "notification-banner " + type;
    banner.style.display = "block";
}
function hideBanner() { const banner = document.getElementById("notificationBanner"); if (banner) banner.style.display = "none"; }

function showTemporaryNotification(message, type = "info", timeout = 3000) {
    if (!espOffline) { showBanner(message, type); setTimeout(hideBanner, timeout); }
    else showToast(message, type);
}

function showToast(message, type = "success") {
    const existing = document.querySelector(".toast-incubator");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = "toast-incubator";
    toast.style.cssText = `position: fixed; top: 30px; right: 30px; padding: 15px 25px; background: ${type === "success" ? "#4caf50" : type === "error" ? "#f44336" : "#ff9800"}; color: white; border-radius: 10px; font-weight: 500; z-index: 3000; animation: slideInRight 0.3s ease; box-shadow: 0 5px 20px rgba(0,0,0,0.2); display: flex; align-items: center; gap: 10px;`;
    const icon = type === "success" ? "fa-check-circle" : type === "error" ? "fa-exclamation-circle" : "fa-exclamation-triangle";
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.animation = "slideOutRight 0.3s ease"; setTimeout(() => toast.remove(), 300); }, 3000);
}

const style = document.createElement("style");
style.textContent = "@keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } } @keyframes slideOutRight { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }";
document.head.appendChild(style);

function startSprayerCountdown(durationSeconds) {
    if (countdownInterval) clearInterval(countdownInterval);
    sprayerEndTime = Date.now() + durationSeconds * 1000;
    const countdownEl = document.getElementById("sprayerCountdown");
    const timeEl = document.getElementById("countdownTime");
    if (!countdownEl || !timeEl) return;
    countdownEl.style.display = "flex";
    countdownInterval = setInterval(() => {
        const remaining = Math.max(0, Math.floor((sprayerEndTime - Date.now()) / 1000));
        timeEl.textContent = remaining + "s";
        if (remaining <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            countdownEl.style.display = "none";
            if (currentMode === "manual") setRelay("sprayer", false);
        }
    }, 1000);
}

function stopSprayerCountdown() {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    const countdownEl = document.getElementById("sprayerCountdown");
    if (countdownEl) countdownEl.style.display = "none";
}

function checkESPConnection() {
    const nowSec = Math.floor(Date.now() / 1000);
    if (lastSeenTime > 0) updateESPStatus(nowSec - lastSeenTime <= 20);
    else updateESPStatus((Date.now() - lastSensorTime) <= 20000);
}

function todayDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatDate(value) {
    if (!value) return "-";
    const dt = new Date(value + "T00:00:00");
    return dt.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(timestamp) {
    if (!timestamp) return "-";
    return new Date(timestamp).toLocaleString("id-ID");
}

