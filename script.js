// ==================== FIREBASE CONFIG ====================
const firebaseConfig = {
    apiKey: "AIzaSyAQe__wZ1_xjW6dLjWTCgKDamN5EnT5mjc",
    databaseURL: "https://smart-incubator-d53d4-default-rtdb.asia-southeast1.firebasedatabase.app/"
};

// Initialize Firebase
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
let scheduleTimes = ["08:00", "15:00"]; // default jadwal manual
let countdownInterval = null;
let sprayerEndTime = null;

// ==================== DOM READY ====================
document.addEventListener("DOMContentLoaded", function () {
    console.log("🌿 Inkubator Dashboard Ready!");
    initUI();
    initFirebaseListeners();
    initEventListeners();
    updateTime();
    setInterval(updateTime, 1000);
    setInterval(checkESPConnection, 5000);
});

// ==================== INIT UI ====================
function initUI() {
    // Set default values
    document.getElementById("minTemp").value = 26;
    document.getElementById("maxTemp").value = 33;
    document.getElementById("sprayerDurasi").value = 5;

    // Brightness slider
    const brightnessSlider = document.getElementById("brightnessSlider");
    const brightnessValue = document.getElementById("brightnessValue");
    if (brightnessSlider && brightnessValue) {
        brightnessSlider.value = 60;
        brightnessValue.textContent = "60%";
    }

    // Jadwal default
    scheduleTimes = ["08:00", "15:00"];
    renderScheduleList(scheduleTimes);
}

// ==================== FIREBASE LISTENERS ====================
function initFirebaseListeners() {
    console.log("🔥 Firebase Listeners Active");

    // Koneksi Firebase
    db.ref(".info/connected").on("value", (snapshot) => {
        updateConnectionStatus(snapshot.val());
    });

    // Mode
    db.ref("/device/inkubator_1/mode").on("value", (snapshot) => {
        const mode = snapshot.val();
        if (mode) {
            currentMode = mode;
            updateModeUI(mode);
        }
    });

    // Sensor suhu
    db.ref("/device/inkubator_1/sensor/temperature").on("value", (snapshot) => {
        const suhu = snapshot.val();
        if (suhu !== null) {
            lastSensorTime = Date.now();
            updateTemperatureUI(suhu);
            if (currentPlant) updatePlantStatusIndicators();
        }
    });

    // Sensor kelembaban
    db.ref("/device/inkubator_1/sensor/humidity").on("value", (snapshot) => {
        const hum = snapshot.val();
        if (hum !== null) {
            lastSensorTime = Date.now();
            updateHumidityUI(hum);
            if (currentPlant) updatePlantStatusIndicators();
        }
    });

    // Relay Fan
    db.ref("/device/inkubator_1/relay/fan").on("value", (snapshot) => {
        updateRelayUI("kipas", snapshot.val() ? 1 : 0);
    });

    // Relay Sprayer
    db.ref("/device/inkubator_1/relay/sprayer").on("value", (snapshot) => {
        updateRelayUI("sprayer", snapshot.val() ? 1 : 0);
    });

    // Relay Lamp
    db.ref("/device/inkubator_1/relay/lamp").on("value", (snapshot) => {
        const status = snapshot.val() ? 1 : 0;
        updateLampuRelayUI(status);
        updateLampPWMStatus();
    });

    // PWM Lamp
    db.ref("/device/inkubator_1/lamp_pwm").on("value", (snapshot) => {
        const brightness = snapshot.val();
        if (brightness !== null) {
            updateBrightnessUI(brightness);
        }
    });

    // Manual sprayer times
    db.ref("/device/inkubator_1/manual/sprayer_times").on("value", (snapshot) => {
        const times = snapshot.val();
        if (times && Array.isArray(times)) {
            scheduleTimes = times;
            renderScheduleList(scheduleTimes);
        }
    });

    // Manual sprayer duration
    db.ref("/device/inkubator_1/manual/sprayer_duration").on("value", (snapshot) => {
        const durasi = snapshot.val();
        if (durasi !== null) {
            document.getElementById("sprayerDurasi").value = durasi;
        }
    });

    // Last seen untuk deteksi ESP offline
    db.ref("/device/inkubator_1/last_seen").on("value", (snapshot) => {
        const ts = snapshot.val();
        if (ts !== null) {
            lastSeenTime = ts;
            const now = Math.floor(Date.now() / 1000);
            updateESPStatus(now - ts <= 20);
        } else {
            lastSeenTime = 0;
        }
    });

    // Daftar tanaman
    db.ref("/plants").on("value", (snapshot) => {
        plantsList = snapshot.val() || {};
        renderPlantButtons();
        // Cek apakah ada tanaman aktif
        db.ref("/device/inkubator_1/active_plant").once("value", (plantSnap) => {
            const activeId = plantSnap.val();
            if (activeId && plantsList[activeId]) {
                selectPlantById(activeId);
            }
        });
    });
}

// ==================== DETEKSI ESP OFFLINE ====================
function checkESPConnection() {
    const nowSec = Math.floor(Date.now() / 1000);
    if (lastSeenTime > 0) {
        const diff = nowSec - lastSeenTime;
        updateESPStatus(diff <= 20);
    } else {
        const diffMs = Date.now() - lastSensorTime;
        updateESPStatus(diffMs <= 20000);
    }
}

// ==================== RENDER TANAMAN ====================
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

    // Tombol custom
    const customBtn = document.createElement("button");
    customBtn.className = "plant-btn";
    customBtn.dataset.plantId = "custom";
    customBtn.innerHTML = `<i class="fas fa-plus"></i><span>Custom</span>`;
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

    currentPlant = {
        id: plantId,
        name: plant.name,
        tempMin: plant.temp_optimal?.min || 20,
        tempMax: plant.temp_optimal?.max || 30,
        lightPWM: plant.light_pwm || 60,
        wateringDuration: plant.watering?.duration || 10,
        wateringTimes: plant.watering?.times || ["08:00", "15:00"],
        auto: plant.auto !== false
    };

    updatePlantInfo(currentPlant);
    db.ref("/device/inkubator_1/active_plant").set(plantId);

    // Highlight tombol aktif
    document.querySelectorAll(".plant-btn").forEach(btn => btn.classList.remove("active"));
    const activeBtn = Array.from(document.querySelectorAll(".plant-btn")).find(btn => btn.dataset.plantId === plantId);
    if (activeBtn) activeBtn.classList.add("active");

    // Isi jadwal dan durasi dari tanaman
    scheduleTimes = [...currentPlant.wateringTimes];
    renderScheduleList(scheduleTimes);
    document.getElementById("sprayerDurasi").value = currentPlant.wateringDuration;

    hideCustomPlantForm();
    showPlantActions();
}

// ==================== PLANT FEATURES ====================
function updatePlantInfo(plant) {
    document.querySelector(".plant-name").textContent = plant.name;
    document.querySelector(".plant-status").textContent = `Tanaman ${plant.name} aktif`;
    document.getElementById("tempRequirement").textContent = `${plant.tempMin}°C - ${plant.tempMax}°C`;
    document.getElementById("tempReqRange").textContent = `Min: ${plant.tempMin}°C, Max: ${plant.tempMax}°C`;
    const midTemp = (plant.tempMin + plant.tempMax) / 2;
    document.getElementById("tempReqFill").style.width = (midTemp / 50 * 100) + "%";

    // Kelembaban default (sementara)
    document.getElementById("humidityRequirement").textContent = "60%";
    document.getElementById("humidityReqRange").textContent = "Optimal: 60%";
    document.getElementById("humidityReqFill").style.width = "60%";
}

function showPlantActions() {
    document.getElementById("plantActions").style.display = "flex";
}

function hidePlantActions() {
    document.getElementById("plantActions").style.display = "none";
}

function showCustomPlantForm() {
    editingPlantId = null;
    document.querySelector("#plantCustomForm .custom-title").textContent = "Tanaman Custom";
    document.getElementById("saveCustomBtn").innerHTML = '<i class="fas fa-save"></i> Simpan Tanaman';

    // Reset form
    document.getElementById("customName").value = "";
    document.getElementById("customMinTemp").value = "20";
    document.getElementById("customMaxTemp").value = "30";
    document.getElementById("customLightPWM").value = "60";
    document.getElementById("customLightValue").textContent = "60%";
    document.getElementById("customDuration").value = "10";
    document.getElementById("customTimePagi").value = "08:00";
    document.getElementById("customTimeSore").value = "15:00";
    document.getElementById("customAuto").checked = true;

    document.getElementById("plantCustomForm").style.display = "block";
    hidePlantActions();
}

function hideCustomPlantForm() {
    document.getElementById("plantCustomForm").style.display = "none";
}

function saveCustomPlant() {
    const name = document.getElementById("customName").value.trim();
    const minTemp = parseInt(document.getElementById("customMinTemp").value);
    const maxTemp = parseInt(document.getElementById("customMaxTemp").value);
    const lightPWM = parseInt(document.getElementById("customLightPWM").value);
    const duration = parseInt(document.getElementById("customDuration").value);
    const timePagi = document.getElementById("customTimePagi").value;
    const timeSore = document.getElementById("customTimeSore").value;
    const auto = document.getElementById("customAuto").checked;

    if (!name) {
        showTemporaryNotification("Masukkan nama tanaman!", "error");
        return;
    }
    if (minTemp >= maxTemp) {
        showTemporaryNotification("Suhu minimum harus kurang dari maksimum!", "error");
        return;
    }
    if (duration < 1 || duration > 60) {
        showTemporaryNotification("Durasi harus 1-60 detik!", "error");
        return;
    }

    const plantData = {
        name: name,
        auto: auto,
        light_kelvin: 6500,
        light_pwm: lightPWM,
        par_target: 200,
        temp_optimal: { min: minTemp, max: maxTemp },
        watering: { duration: duration, times: [timePagi, timeSore] }
    };

    if (editingPlantId) {
        db.ref("/plants/" + editingPlantId).update(plantData)
            .then(() => {
                showTemporaryNotification("Tanaman berhasil diperbarui!", "success");
                editingPlantId = null;
                document.querySelector("#plantCustomForm .custom-title").textContent = "Tanaman Custom";
                document.getElementById("saveCustomBtn").innerHTML = '<i class="fas fa-save"></i> Simpan Tanaman';
                hideCustomPlantForm();
                selectPlantById(editingPlantId);
            })
            .catch((error) => {
                console.error("Error updating plant:", error);
                showTemporaryNotification("Gagal memperbarui tanaman!", "error");
            });
    } else {
        const plantId = "plant_" + Date.now();
        db.ref("/plants/" + plantId).set(plantData)
            .then(() => {
                showTemporaryNotification("Tanaman berhasil disimpan!", "success");
                cancelCustomPlant();
            })
            .catch((error) => {
                console.error("Error saving plant:", error);
                showTemporaryNotification("Gagal menyimpan tanaman!", "error");
            });
    }
}

function cancelCustomPlant() {
    hideCustomPlantForm();
    editingPlantId = null;
    document.querySelector("#plantCustomForm .custom-title").textContent = "Tanaman Custom";
    document.getElementById("saveCustomBtn").innerHTML = '<i class="fas fa-save"></i> Simpan Tanaman';

    // Kembali ke tanaman aktif sebelumnya
    db.ref("/device/inkubator_1/active_plant").once("value", (snap) => {
        const activeId = snap.val();
        if (activeId && plantsList[activeId]) {
            selectPlantById(activeId);
        } else {
            resetPlantInfo();
        }
    });
}

function applyPlantSettings() {
    if (!currentPlant) {
        showToast("Tidak ada tanaman yang dipilih", "warning");
        return;
    }

    // Terapkan setpoint suhu (tampilan)
    document.getElementById("minTemp").value = currentPlant.tempMin;
    document.getElementById("maxTemp").value = currentPlant.tempMax;
    updateTempRange();

    // Terapkan jadwal sprayer ke form
    scheduleTimes = [...currentPlant.wateringTimes];
    renderScheduleList(scheduleTimes);
    document.getElementById("sprayerDurasi").value = currentPlant.wateringDuration;

    // Kirim kecerahan lampu ke database
    db.ref("/device/inkubator_1/lamp_pwm").set(currentPlant.lightPWM)
        .catch(err => console.error("Gagal set lamp_pwm:", err));

    showTemporaryNotification(`Pengaturan ${currentPlant.name} diterapkan`, "success");
}

function removeCurrentPlant() {
    if (!currentPlant || !currentPlant.id) return;
    if (confirm(`Hapus tanaman ${currentPlant.name}?`)) {
        db.ref("/plants/" + currentPlant.id).remove()
            .then(() => {
                showTemporaryNotification("Tanaman dihapus", "success");
                resetPlantInfo();
                db.ref("/device/inkubator_1/active_plant").set("");
            })
            .catch(error => showTemporaryNotification("Gagal menghapus", "error"));
    }
} 


function resetPlantInfo() {
    currentPlant = null;
    document.querySelector(".plant-name").textContent = "Belum ada tanaman";
    document.querySelector(".plant-status").textContent = "Pilih tanaman untuk melihat kebutuhan";
    document.getElementById("tempRequirement").textContent = "--°C";
    document.getElementById("tempReqRange").textContent = "Min: --°C, Max: --°C";
    document.getElementById("tempReqFill").style.width = "0%";
    document.getElementById("humidityRequirement").textContent = "--%";
    document.getElementById("humidityReqRange").textContent = "Optimal: --%";
    document.getElementById("humidityReqFill").style.width = "0%";

    hidePlantActions();
    hideCustomPlantForm();
    document.querySelectorAll(".plant-btn").forEach(btn => btn.classList.remove("active"));
}

function editPlant() {
    if (!currentPlant || !currentPlant.id) return;

    document.getElementById("customName").value = currentPlant.name;
    document.getElementById("customMinTemp").value = currentPlant.tempMin;
    document.getElementById("customMaxTemp").value = currentPlant.tempMax;
    document.getElementById("customLightPWM").value = currentPlant.lightPWM;
    document.getElementById("customLightValue").textContent = currentPlant.lightPWM + "%";
    document.getElementById("customDuration").value = currentPlant.wateringDuration;
    document.getElementById("customTimePagi").value = currentPlant.wateringTimes[0] || "08:00";
    document.getElementById("customTimeSore").value = currentPlant.wateringTimes[1] || "15:00";
    document.getElementById("customAuto").checked = currentPlant.auto;

    editingPlantId = currentPlant.id;
    document.querySelector("#plantCustomForm .custom-title").textContent = "Edit Tanaman";
    document.getElementById("saveCustomBtn").innerHTML = '<i class="fas fa-save"></i> Update Tanaman';

    hidePlantActions();
    document.getElementById("plantCustomForm").style.display = "block";
}

// ==================== JADWAL SPRAYER DINAMIS ====================
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
        item.innerHTML = `
            <input type="time" class="schedule-time-input" data-index="${index}" value="${time}">
            <button class="remove-time" data-index="${index}"><i class="fas fa-times"></i></button>
        `;
        container.appendChild(item);
    });

    document.querySelectorAll(".schedule-time-input").forEach(input => {
        input.addEventListener("change", function (e) {
            const idx = parseInt(this.dataset.index);
            scheduleTimes[idx] = this.value;
        });
    });

    document.querySelectorAll(".remove-time").forEach(btn => {
        btn.addEventListener("click", function (e) {
            const idx = parseInt(this.dataset.index);
            scheduleTimes.splice(idx, 1);
            renderScheduleList(scheduleTimes);
        });
    });
}

// ==================== EVENT LISTENERS ====================
function initEventListeners() {
    // Mode buttons
    document.getElementById("autoModeBtn").addEventListener("click", () => setMode("auto"));
    document.getElementById("manualModeBtn").addEventListener("click", () => setMode("manual"));

    // Relay toggles
    document.getElementById("kipasToggle").addEventListener("change", function (e) {
        if (currentMode === "manual") setRelay("fan", e.target.checked);
        else {
            e.target.checked = !e.target.checked;
            showToast("Mode Auto aktif! Ganti ke Manual dulu.", "warning");
        }
    });

    document.getElementById("sprayerToggle").addEventListener("change", function (e) {
        if (currentMode === "manual") setRelay("sprayer", e.target.checked);
        else {
            e.target.checked = !e.target.checked;
            showToast("Mode Auto aktif! Ganti ke Manual dulu.", "warning");
        }
    });

    document.getElementById("lampuRelayToggle").addEventListener("change", function (e) {
        if (currentMode === "manual") setRelay("lamp", e.target.checked);
        else {
            e.target.checked = !e.target.checked;
            showToast("Mode Auto aktif! Ganti ke Manual dulu.", "warning");
        }
    });

    document.getElementById("lampPWMToggle").addEventListener("change", function (e) {
        if (currentMode === "manual") setRelay("lamp", e.target.checked);
        else {
            e.target.checked = !e.target.checked;
            showToast("Mode Auto aktif! Ganti ke Manual dulu.", "warning");
        }
    });

    // Brightness slider
    const brightnessSlider = document.getElementById("brightnessSlider");
    const brightnessValue = document.getElementById("brightnessValue");
    brightnessSlider.addEventListener("input", function (e) {
        brightnessValue.textContent = e.target.value + "%";
    });
    brightnessSlider.addEventListener("change", function (e) {
        if (currentMode === "manual") {
            const brightness = parseInt(e.target.value);
            db.ref("/device/inkubator_1/lamp_pwm").set(brightness);
            showTemporaryNotification(`Kecerahan lampu: ${brightness}%`, "success");
        } else {
            showToast("Mode Auto aktif! Ganti ke Manual dulu.", "warning");
        }
    });

    // Save setpoint (hanya info)
    document.getElementById("saveSetpointBtn").addEventListener("click", () => {
        showToast("Setpoint suhu mengikuti tanaman yang dipilih", "info");
    });

    // Save sprayer
    document.getElementById("saveSprayerBtn").addEventListener("click", saveSprayerSchedule);

    // Add schedule button
    document.getElementById("addScheduleBtn").addEventListener("click", function () {
        scheduleTimes.push("12:00");
        renderScheduleList(scheduleTimes);
    });

    // Close banner
    const closeBanner = document.getElementById("closeBanner");
    if (closeBanner) closeBanner.addEventListener("click", hideBanner);

    // Plant buttons
    document.getElementById("cancelCustomBtn").addEventListener("click", cancelCustomPlant);
    document.getElementById("saveCustomBtn").addEventListener("click", saveCustomPlant);
    document.getElementById("applySettingsBtn").addEventListener("click", () => {
        if (currentPlant) applyPlantSettings();
        else showToast("Pilih tanaman terlebih dahulu", "warning");
    });
    document.getElementById("removePlantBtn").addEventListener("click", removeCurrentPlant);
    document.getElementById("editPlantBtn").addEventListener("click", editPlant);

    // Custom light slider
    const customLight = document.getElementById("customLightPWM");
    const customLightVal = document.getElementById("customLightValue");
    if (customLight && customLightVal) {
        customLight.addEventListener("input", (e) => {
            customLightVal.textContent = e.target.value + "%";
        });
    }
}

// ==================== FIREBASE ACTIONS ====================
function setMode(mode) {
    db.ref("/device/inkubator_1/mode").set(mode)
        .then(() => showTemporaryNotification(`Mode diubah ke ${mode.toUpperCase()}`, "success"))
        .catch(() => showTemporaryNotification("Gagal mengubah mode!", "error"));
}

function setRelay(relay, value) {
    db.ref("/device/inkubator_1/relay/" + relay).set(value)
        .then(() => showTemporaryNotification(`Relay ${relay} ${value ? 'ON' : 'OFF'}`, "success"))
        .catch(() => showTemporaryNotification(`Gagal mengontrol ${relay}!`, "error"));
}

function saveSprayerSchedule() {
    const durasi = parseInt(document.getElementById("sprayerDurasi").value);
    if (durasi < 1 || durasi > 60) {
        showTemporaryNotification("Durasi harus 1-60 detik!", "error");
        return;
    }
    const validTimes = scheduleTimes.filter(t => t && t.trim() !== "");
    if (validTimes.length === 0) {
        showTemporaryNotification("Setidaknya satu jadwal harus diisi!", "error");
        return;
    }
    Promise.all([
        db.ref("/device/inkubator_1/manual/sprayer_times").set(validTimes),
        db.ref("/device/inkubator_1/manual/sprayer_duration").set(durasi)
    ]).then(() => {
        showTemporaryNotification("Jadwal sprayer tersimpan!", "success");
    }).catch(() => showTemporaryNotification("Gagal menyimpan jadwal!", "error"));
}

// ==================== UI UPDATE FUNCTIONS ====================
function updateTemperatureUI(suhu) {
    const el = document.getElementById("temperatureValue");
    const progressEl = document.getElementById("tempProgress");
    if (el) el.textContent = suhu.toFixed(1);
    if (progressEl) progressEl.style.width = Math.min((suhu / 50) * 100, 100) + "%";

    if (!currentPlant) {
        const min = parseInt(document.getElementById("minTemp").value || 26);
        const max = parseInt(document.getElementById("maxTemp").value || 33);
        const statusEl = document.getElementById("temperatureStatus");
        if (statusEl) {
            if (suhu < min) {
                statusEl.innerHTML = '<i class="fas fa-thermometer-empty"></i> Terlalu Rendah';
                statusEl.style.color = "#2196f3";
            } else if (suhu > max) {
                statusEl.innerHTML = '<i class="fas fa-thermometer-full"></i> Terlalu Tinggi';
                statusEl.style.color = "#f44336";
            } else {
                statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Optimal';
                statusEl.style.color = "#4caf50";
            }
        }
    }
}

function updateHumidityUI(hum) {
    const el = document.getElementById("humidityValue");
    const progressEl = document.getElementById("humProgress");
    if (el) el.textContent = hum.toFixed(1);
    if (progressEl) progressEl.style.width = hum + "%";

    if (!currentPlant) {
        const statusEl = document.getElementById("humidityStatus");
        if (statusEl) {
            if (hum < 40) {
                statusEl.innerHTML = '<i class="fas fa-tint"></i> Terlalu Kering';
                statusEl.style.color = "#ff9800";
            } else if (hum > 80) {
                statusEl.innerHTML = '<i class="fas fa-tint"></i> Terlalu Lembab';
                statusEl.style.color = "#2196f3";
            } else {
                statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Optimal';
                statusEl.style.color = "#4caf50";
            }
        }
    }
}

function updateRelayUI(relay, status) {
    const stateEl = document.getElementById(relay + "Status");
    const toggleEl = document.getElementById(relay + "Toggle");
    if (stateEl) {
        stateEl.textContent = status === 1 ? "ON" : "OFF";
        stateEl.style.color = status === 1 ? "#4caf50" : "#ff5252";
        if (toggleEl) toggleEl.checked = status === 1;
    }

    // Countdown untuk sprayer
    if (relay === "sprayer") {
        if (status === 1) {
            let duration = 5;
            if (currentMode === "manual") {
                duration = parseInt(document.getElementById("sprayerDurasi").value) || 5;
            } else {
                duration = currentPlant?.wateringDuration || 5;
            }
            startSprayerCountdown(duration);
        } else {
            stopSprayerCountdown();
        }
    }
}

function updateLampuRelayUI(status) {
    const stateEl = document.getElementById("lampuRelayStatus");
    const toggleEl = document.getElementById("lampuRelayToggle");
    const pwmToggle = document.getElementById("lampPWMToggle");
    if (stateEl) {
        stateEl.textContent = status === 1 ? "ON" : "OFF";
        stateEl.style.color = status === 1 ? "#4caf50" : "#ff5252";
        if (toggleEl) toggleEl.checked = status === 1;
        if (pwmToggle) pwmToggle.checked = status === 1;
    }
}

function updateBrightnessUI(brightness) {
    const valueEl = document.getElementById("brightnessValue");
    const sliderEl = document.getElementById("brightnessSlider");
    if (valueEl) valueEl.textContent = brightness + "%";
    if (sliderEl) sliderEl.value = brightness;
}

function updateLampPWMStatus() {
    db.ref("/device/inkubator_1/relay/lamp").once("value", (snap) => {
        const status = snap.val();
        const lampStatus = document.getElementById("lampPWMStatus");
        if (lampStatus) {
            lampStatus.textContent = status ? "ON" : "OFF";
            lampStatus.style.color = status ? "#4caf50" : "#ff5252";
        }
    });
}

function updateModeUI(mode) {
    const autoBtn = document.getElementById("autoModeBtn");
    const manualBtn = document.getElementById("manualModeBtn");
    const modeBadge = document.getElementById("currentModeBadge");

    if (mode === "auto") {
        autoBtn.classList.add("active");
        manualBtn.classList.remove("active");
        if (modeBadge) {
            modeBadge.textContent = "AUTO";
            modeBadge.style.background = "#4caf50";
        }
        // Disable manual controls
        document.getElementById("kipasToggle").disabled = true;
        document.getElementById("sprayerToggle").disabled = true;
        document.getElementById("lampuRelayToggle").disabled = true;
        document.getElementById("lampPWMToggle").disabled = true;
        document.getElementById("brightnessSlider").disabled = true;
    } else {
        autoBtn.classList.remove("active");
        manualBtn.classList.add("active");
        if (modeBadge) {
            modeBadge.textContent = "MANUAL";
            modeBadge.style.background = "#9c27b0";
        }
        document.getElementById("kipasToggle").disabled = false;
        document.getElementById("sprayerToggle").disabled = false;
        document.getElementById("lampuRelayToggle").disabled = false;
        document.getElementById("lampPWMToggle").disabled = false;
        document.getElementById("brightnessSlider").disabled = false;
    }

    // Disable/enable jadwal sprayer sesuai mode
    const timeInputs = document.querySelectorAll(".schedule-time-input");
    const removeBtns = document.querySelectorAll(".remove-time");
    const addBtn = document.getElementById("addScheduleBtn");
    const durasiInput = document.getElementById("sprayerDurasi");

    if (mode === "auto") {
        timeInputs.forEach(inp => inp.disabled = true);
        removeBtns.forEach(btn => btn.disabled = true);
        if (addBtn) addBtn.disabled = true;
        durasiInput.disabled = true;
    } else {
        timeInputs.forEach(inp => inp.disabled = false);
        removeBtns.forEach(btn => btn.disabled = false);
        if (addBtn) addBtn.disabled = false;
        durasiInput.disabled = false;
    }

    // Restart countdown jika sprayer sedang ON
    db.ref("/device/inkubator_1/relay/sprayer").once("value", (snap) => {
        if (snap.val() === true) {
            let duration = mode === "auto"
                ? (currentPlant?.wateringDuration || 5)
                : (parseInt(document.getElementById("sprayerDurasi").value) || 5);
            startSprayerCountdown(duration);
        }
    });
}

function updateTempRange() {
    const min = document.getElementById("minTemp").value;
    const max = document.getElementById("maxTemp").value;
    const rangeEl = document.getElementById("tempRange");
    if (rangeEl) rangeEl.textContent = min + "-" + max + "°C";
}

function updateESPStatus(online) {
    const espStatus = document.getElementById("esp32Status");
    const wifiStatus = document.getElementById("wifiStatus");

    espOffline = !online;

    if (online) {
        if (espStatus) {
            espStatus.textContent = "Online";
            espStatus.className = "status-value online";
        }
        if (wifiStatus) {
            wifiStatus.textContent = "Terhubung";
            wifiStatus.className = "status-value online";
        }
        hideBanner();
    } else {
        if (espStatus) {
            espStatus.textContent = "Offline";
            espStatus.className = "status-value offline";
        }
        if (wifiStatus) {
            wifiStatus.textContent = "Terputus";
            wifiStatus.className = "status-value offline";
        }
        showBanner("⚠️ ESP32 tidak terhubung! Periksa koneksi perangkat.", "error");
    }
}

function updateConnectionStatus(connected) {
    const connectionText = document.getElementById("connectionText");
    const connectionDot = document.getElementById("connectionDot");
    const firebaseStatus = document.getElementById("firebaseStatus");
    const streamStatus = document.getElementById("streamStatus");

    if (connected) {
        if (connectionText) connectionText.textContent = "Terhubung ke Firebase";
        if (connectionDot) connectionDot.className = "status-dot connected";
        if (firebaseStatus) {
            firebaseStatus.textContent = "Aktif";
            firebaseStatus.className = "status-value online";
        }
        if (streamStatus) {
            streamStatus.textContent = "Aktif";
            streamStatus.className = "status-value online";
        }
    } else {
        if (connectionText) connectionText.textContent = "Terputus dari Firebase";
        if (connectionDot) connectionDot.className = "status-dot";
        if (firebaseStatus) {
            firebaseStatus.textContent = "Offline";
            firebaseStatus.className = "status-value offline";
        }
        if (streamStatus) {
            streamStatus.textContent = "Offline";
            streamStatus.className = "status-value offline";
        }
    }
}

function updateTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("id-ID");
    const updateEl = document.getElementById("sensorUpdateTime");
    if (updateEl) updateEl.textContent = timeStr;
    const lastUpdate = document.getElementById("lastUpdate");
    if (lastUpdate) {
        lastUpdate.innerHTML = `<i class="fas fa-clock"></i><span>Terakhir update: ${timeStr}</span>`;
    }
}

function updatePlantStatusIndicators() {
    if (!currentPlant) return;
    const suhu = parseFloat(document.getElementById("temperatureValue")?.textContent);
    const hum = parseFloat(document.getElementById("humidityValue")?.textContent);
    if (isNaN(suhu) || isNaN(hum)) return;

    const tempStatus = document.getElementById("temperatureStatus");
    const humStatus = document.getElementById("humidityStatus");

    if (tempStatus) {
        if (suhu < currentPlant.tempMin) {
            tempStatus.innerHTML = `<i class="fas fa-thermometer-empty"></i> Terlalu rendah untuk ${currentPlant.name}`;
            tempStatus.style.color = "#2196f3";
        } else if (suhu > currentPlant.tempMax) {
            tempStatus.innerHTML = `<i class="fas fa-thermometer-full"></i> Terlalu tinggi untuk ${currentPlant.name}`;
            tempStatus.style.color = "#ff5252";
        } else {
            tempStatus.innerHTML = `<i class="fas fa-check-circle"></i> Optimal untuk ${currentPlant.name}`;
            tempStatus.style.color = "#4caf50";
        }
    }

    if (humStatus) {
        if (hum < 40) {
            humStatus.innerHTML = `<i class="fas fa-tint"></i> Terlalu kering untuk ${currentPlant.name}`;
            humStatus.style.color = "#ff9800";
        } else if (hum > 80) {
            humStatus.innerHTML = `<i class="fas fa-tint"></i> Terlalu lembab untuk ${currentPlant.name}`;
            humStatus.style.color = "#2196f3";
        } else {
            humStatus.innerHTML = `<i class="fas fa-check-circle"></i> Optimal untuk ${currentPlant.name}`;
            humStatus.style.color = "#4caf50";
        }
    }
}

// ==================== NOTIFICATION BANNER ====================
function showBanner(message, type = "error") {
    const banner = document.getElementById("notificationBanner");
    const bannerMessage = document.getElementById("bannerMessage");
    if (!banner || !bannerMessage) return;

    bannerMessage.textContent = message;
    banner.className = "notification-banner " + type;
    banner.style.display = "block";
}

function hideBanner() {
    const banner = document.getElementById("notificationBanner");
    if (banner) banner.style.display = "none";
}

function showTemporaryNotification(message, type = "info", timeout = 3000) {
    if (!espOffline) {
        showBanner(message, type);
        setTimeout(hideBanner, timeout);
    } else {
        showToast(message, type);
    }
}

// ==================== TOAST ====================
function showToast(message, type = "success") {
    const existing = document.querySelector(".toast-incubator");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "toast-incubator";
    toast.style.cssText = `
        position: fixed;
        top: 30px;
        right: 30px;
        padding: 15px 25px;
        background: ${type === "success" ? "#4caf50" : type === "error" ? "#f44336" : "#ff9800"};
        color: white;
        border-radius: 10px;
        font-weight: 500;
        z-index: 3000;
        animation: slideInRight 0.3s ease;
        box-shadow: 0 5px 20px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        gap: 10px;
    `;
    const icon = type === "success" ? "fa-check-circle" : type === "error" ? "fa-exclamation-circle" : "fa-exclamation-triangle";
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = "slideOutRight 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Animations
const style = document.createElement("style");
style.textContent = `
    @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes slideOutRight { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
`;
document.head.appendChild(style);

// ==================== COUNTDOWN SPRAYER ====================
function startSprayerCountdown(durationSeconds) {
    if (countdownInterval) clearInterval(countdownInterval);

    const endTime = Date.now() + durationSeconds * 1000;
    sprayerEndTime = endTime;

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
            countdownEl.style.display = 'none';

            // Matikan relay sprayer setelah countdown selesai (hanya jika mode manual)
            if (currentMode === 'manual') {
                setRelay('sprayer', false);
            }
            // Jika mode auto, biarkan perangkat yang mengontrol sesuai jadwal
        }
    });
}

function stopSprayerCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    const countdownEl = document.getElementById("sprayerCountdown");
    if (countdownEl) countdownEl.style.display = "none";
}