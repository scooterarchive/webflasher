import * as libstlink from '../src/lib/package.js';
import WebStlink from '../src/webstlink.js'

function fetchResource(url) {
    return new Promise(function(resolve, reject) {
        let xhr = new XMLHttpRequest();
        xhr.responseType = "arraybuffer";
        xhr.addEventListener("load", function() {
            if (this.status != 200) {
                reject(this.status);
            } else {
                resolve(this.response);
            }
        });
        xhr.addEventListener("error", function() {
            reject(this.status);
        });
        xhr.open("GET", url);
        xhr.send();
    });
}

async function pick_sram_variant(mcu_list) {
    // Display a dialog with the MCU variants for the user to pick
    let dialog = document.querySelector("#mcuDialog");
    let tbody = dialog.querySelector("tbody");

    // Remove old entries
    for (let row of tbody.querySelectorAll("tr")) {
        tbody.removeChild(row);
    }

    const columns = [
        ["type", ""],
        ["freq", "MHz"],
        ["flash_size", "KiB"],
        ["sram_size", "KiB"],
        ["eeprom_size", "KiB"],
    ];

    let index = 0;
    for (let mcu of mcu_list) {
        let tr = document.createElement("tr");
        for (let [key, suffix] of columns) {
            let td = document.createElement("td");
            if (key == "type") {
                let label = document.createElement("label");
                let input = document.createElement("input");
                let text = document.createTextNode(mcu[key] + suffix);

                label.appendChild(input);
                label.appendChild(text);
                input.type = "radio";
                input.name = "mcuIndex";
                input.value = mcu.type;
                input.required = true;

                td.appendChild(label);
            } else {
                td.textContent = mcu[key] + suffix;
            }
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }

    let submit_promise = new Promise(function (resolve, reject) {
        function on_submit(evt) {
            dialog.removeEventListener('cancel', on_cancel);
            resolve(evt.target.elements["mcuIndex"].value);
        }

        function on_cancel() {
            dialog.removeEventListener('submit', on_submit);
            reject();
        }

        dialog.addEventListener('cancel', on_cancel, { once: true});
        dialog.addEventListener('submit', on_submit, { once: true});
    });

    dialog.showModal();

    // Wait for the user's selection and return it, otherwise
    // return null if they canceled
    try {
        let type = await submit_promise;
        return type;
    } catch (e) {
        return null;
    }
}

function update_registers(registers) {
    for (let [name, value] of registers) {
        let span = document.getElementById(name);
        let text = (name + ":").padEnd(5);
        text += "0x" + value.toString(16).padStart(8,"0");
        text += value.toString().padStart(12);

        if (text != span.textContent && !span.textContent.endsWith("-")) {
            span.classList.add("register-updated");
        } else {
            span.classList.remove("register-updated");
        }
        
        span.textContent = text;
    }
}

function reset_registers() {
    for (let span of document.querySelectorAll("span.register")) {
        let name = span.id;
        let text = (name + ":").padEnd(5);
        text += "-".repeat(10) + "-".padStart(12);
        span.classList.remove("register-updated");
        span.textContent = text;
    }
}

function update_debugger_info(stlink, device) {
    let probeInfo = document.getElementById("probeInfo");
    let summary = probeInfo.querySelector("summary");
    let version = "ST-Link/" + stlink._stlink.ver_str;
    summary.textContent = `Debugger - ${version} - Connected`;
    document.getElementById("productName").textContent = device.productName;
    document.getElementById("mfgName").textContent = device.manufacturerName;
    document.getElementById("serialNumber").textContent = device.serialNumber;
}

function update_target_status(status, target = null) {
    let targetInfo = document.getElementById("targetInfo");
    let summary = targetInfo.querySelector("summary");

    let targetStatus = document.getElementById("targetStatus");
    if (target !== null) {
        let targetType = document.getElementById("targetType");
        targetType.textContent = "- " + target.type + " -";

        // Remove old target fields
        for (let div of targetInfo.querySelectorAll("div")) {
            targetInfo.removeChild(div);
        }
        
        let fields = [
            ["type",        "Type", ""],
            ["core",        "Core", ""],
            ["dev_id",      "Device ID", ""],
            ["flash_size",  "Flash Size", "KiB"],
            ["sram_size",   "SRAM Size", "KiB"],
        ];
        if (target.eeprom_size > 0) {
            fields.push(["eeprom_size", "EEPROM Size", "KiB"]);
        }
        for (let [key, title, suffix] of fields) {
            let div = document.createElement("div");
            div.textContent = title + ": " + target[key] + suffix;
            targetInfo.appendChild(div);
        }
    }

    let haltState = status.halted ? "Halted" : "Running";
    let debugState = "Debugging " + (status.debug ? "Enabled" : "Disabled");

    targetStatus.textContent = `${haltState}, ${debugState}`;
}

document.addEventListener('DOMContentLoaded', event => {
    var stlink = null;
    var curr_device = null;

    let log = document.querySelector("#log");
    let logger = new libstlink.Logger(1, log);

    document.querySelector("#logLevel").addEventListener('change', function(evt) {
        logger.set_verbose(evt.target.value);
        let desc = evt.target.nextSibling.textContent;
        if (desc.indexOf("-") != -1) {
            desc = desc.substring(0, desc.indexOf("-"));
        }

        this.querySelector("summary").textContent = "Logging Level - " + desc;
    });
    
    let connectButton = document.querySelector("#connect");
    let runHaltButton = document.querySelector("#runHalt");
    let stepButton = document.querySelector("#step");
    let resetButton = document.querySelector("#reset");
    let debugButton = document.querySelector("#debug");
    let readRegistersButton = document.querySelector("#readRegisters");

    debugButton.addEventListener('click', async function() {
        const enable = debugButton.textContent.includes("Enable");
        if (stlink !== null && stlink.connected) {
            await stlink.set_debug_enable(enable);
        }
    });
    
    runHaltButton.addEventListener('click', async function() {
        if (stlink !== null && stlink.connected) {
            if (stlink.last_cpu_status.halted) {
                await stlink.run();
            } else {
                await stlink.halt();
            }
        }
    });

    stepButton.addEventListener('click', async function() {
        if (stlink !== null && stlink.connected) {
            await stlink.step();
        }
    });

    resetButton.addEventListener('click', async function() {
        if (stlink !== null) {
            await stlink.reset(stlink.last_cpu_status.halted);
        }
    });

    readRegistersButton.addEventListener('click', async function(evt) {
        if (stlink !== null && stlink.connected) {
            let registers = await stlink.read_registers();
            update_registers(registers);
        }
    });

    function update_capabilities(status) {
        if (status.debug) {
            debugButton.textContent = "Disable debugging";
            if (status.halted) {
                runHaltButton.textContent = "Run";
                readRegistersButton.disabled = false;
                stepButton.disabled = false;
            } else {
                runHaltButton.textContent = "Halt";
                readRegistersButton.disabled = true;
                stepButton.disabled = true;
            }
            runHaltButton.disabled = false;
            resetButton.disabled = false;
        } else {
            debugButton.textContent = "Enable debugging";
            runHaltButton.disabled = true;
            resetButton.disabled = true;
            stepButton.disabled = true;
            readRegistersButton.disabled = true;
        }
    }

    async function on_successful_attach(stlink, device) {
        // Export for manual debugging
        window.stlink = stlink;
        window.device = device;

        // Reset settings
        connectButton.textContent = "Disconnect";
        debugButton.disabled = false;
        reset_registers();

        // Populate debugger info
        update_debugger_info(stlink, device);

        // Add disconnect handler
        navigator.usb.addEventListener('disconnect', function (evt) {
            if (evt.device === device) {
                navigator.usb.removeEventListener('disconnect', this);
                if (device === curr_device) {
                    on_disconnect();
                }
            }
        });

        // Detect attached target CPU
        let target = await stlink.detect_cpu([], pick_sram_variant);

        // Attach UI callbacks for whenever the CPU state is inspected
        stlink.add_callback('inspect', status => {
            // Update display
            update_target_status(status, null);
            // Update buttons
            update_capabilities(status);
        });

        stlink.add_callback('halted', async () => {
            if (document.getElementById("autoReadRegisters").checked) {
                let registers = await stlink.read_registers();
                update_registers(registers);
            }
        });

        // Update the UI with detected target info and debug state
        let status = await stlink.inspect_cpu();
        update_target_status(status, target);
    }

    function on_disconnect() {
        logger.info("Device disconnected");
        connectButton.textContent = "Connect";
        debugButton.disabled = true;

        readRegistersButton.disabled = true;
        runHaltButton.disabled = true;
        stepButton.disabled = true;
        resetButton.disabled = true;

        let probeInfo = document.getElementById("probeInfo");
        let summary = document.querySelector("summary");
        summary.textContent = `Debugger - Disconnected`;

        document.getElementById("productName").textContent = "";
        document.getElementById("mfgName").textContent = "";
        document.getElementById("serialNumber").textContent = "";
        
        stlink = null;
        curr_device = null;
    }

    if (typeof navigator.usb === 'undefined') {
        logger.error("WebUSB is either disabled or not available in this browser");
        connectButton.disabled = true;
    }
    
    connectButton.addEventListener('click', async function() {
        if (stlink !== null) {
            await stlink.detach();
            on_disconnect();
            return;
        }

        try {
            let device = await navigator.usb.requestDevice({
                filters: libstlink.usb.filters
            });
            logger.clear();
            let next_stlink = new WebStlink(logger)
            await next_stlink.attach(device, logger);
            stlink = next_stlink;
            curr_device = device;
        } catch (err) {
            logger.error(err);
        }

        if (stlink !== null) {
            await on_successful_attach(stlink, curr_device);
        }
    });
});
