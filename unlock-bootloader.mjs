/**
 * Huawei Bootloader Utils by VottusCode
 * Set of scripts to help you with bootloader (un)locking.
 *
 * Warning: The author nor any contributors are responsible for any kind of damage
 * or loss of data that may encounter. You may use these scripts at your own risk.
 * Do not use unless you know what you're doing.
 *
 * Copyright (c) 2022 Mia Lilian Morningstar
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { readFileSync, writeFileSync } from "fs";
import { execWithString, exec } from "./utils/_exec.mjs";
import { adb, fastboot } from "./utils/_binPaths.mjs";
import { adbMessages } from "./utils/_const.mjs";
import { CodeNotFoundException, CommandInvalidException, InvalidImeiException, UnknownOutputException } from "./utils/_exceptions.mjs";

const { imei, autorebootAfter, throwOnUnknownErrors, saveStateAfter } = JSON.parse(await readFileSync("config.json", "utf-8"));

class Bruteforce {
  attempt = 0;
  currentCode = 1000000000000000;
  lastSavedAttempt = 0;
  lastRebootAttempt = 0;

  /**
   * Returns a last saved state if available, otherwise null is returned.
   *
   * @return {number|null}
   */
  getLastSavedState() {
    try {
      const content = readFileSync(`saved_state_${imei}.txt`, "utf-8");
      if (!content || content.trim() <= 0) return null;

      return Number(content);
    } catch {
      return null;
    }
  }

  /**
   * Starts the bruteforcing process.
   */
  async start() {
    this.attempt = 0;
    this.currentCode = this.getLastSavedState() ?? 1000000000000000;

    /**
     * Boot the device into bootloader mode. If the device
     * is already in bootloader mode, it reboots it again, just in
     * case there were already unlock attempts made (for devices without such
     * protection it's not necessary, but it doesn't take much time).
     */
    await this.rebootDevice();

    this.currentCode = this.nextCode();
    await this.bruteforce();

    /**
     * If an exit signal is received, the last code is saved before
     * exiting the script.
     */
    ["SIGINT", "SIGTERM"].forEach((signal) => {
      process.on(signal, () => {
        console.error("Signal received, saving last state.");
        this.saveLastState(this.currentCode);
      });
    });
  }

  /**
   * This is a recursive function that runs itself until
   * it finds the code. It is the heart of this whole script.
   *
   * @return {Promise<number>}
   */
  async bruteforce() {
    console.log("Attempting code", this.currentCode);
    const result = await this.attemptCode(this.currentCode);

    /**
     * If true is returned, the current code is the correct unlock code.
     * It's printed out, saved and returned and the recursion ends.
     */
    if (result) {
      console.log("Success! The code is: ", result);
      this.saveBootloaderCode(this.currentCode);
      return this.currentCode;
    }

    /**
     * If enabled, the device is automatically rebooted every X attempts.
     * This is useful for devices that reboot every 5 attempts as a protection.
     */
    if (autorebootAfter) {
      if (this.attempt - this.lastRebootAttempt >= autorebootAfter - 1) {
        this.lastRebootAttempt = this.attempt;
        await this.rebootDevice();
      }
    }

    /**
     * If enabled, the last attempted code is saved every X attempts
     * in case the script is interrupted.
     *
     * Should not be set too low to prevent wearout of the drive.
     */
    if (saveStateAfter) {
      if (this.attempt - this.lastSavedAttempt >= saveStateAfter - 1) {
        this.lastSavedAttempt = this.attempt;
        this.saveLastState(this.currentCode);
      }
    }

    /**
     * Creates the next code and runs this function again.
     */
    this.currentCode = this.nextCode();

    /**
     * At this point no OEM code was found because all combinations
     * were tried and the next one would be too big.
     */
    if (this.currentCode >= 10000000000000000) {
      throw new CodeNotFoundException("No combination found");
    }

    return await this.bruteforce();
  }

  // todo: tbd
  nextCode() {
    return Math.round(Number(String(this.currentCode + Math.sqrt(imei) * 1024).padStart(16, "0")));
  }

  /**
   * Attempts to use a specified code on the device.
   *
   * @param {number} code
   * @throws {CommandInvalidException}
   * @throws {UnknownOutputException}
   * @return {Promise<boolean>}
   */
  async attemptCode(code) {
    const adbOutput = (await execWithString(`${adb} oem unlock ${code}`)).toLowerCase().trim();

    console.log("adb output: ", adbOutput);

    if (adbOutput.includes(adbMessages.commandInvalid)) {
      throw new CommandInvalidException("adb does not recognize the unlock command.");
    }

    if (adbOutput.includes(adbMessages.oemUnlockFail)) {
      return false;
    }

    if (adbOutput.includes(adbMessages.oemUnlockSuccess)) {
      return true;
    }

    if (throwOnUnknownErrors) {
      throw new UnknownOutputException();
    }

    return false;
  }

  /**
   * Reboots the device into the selected mode.
   * Defaults to bootloader.
   *
   * @param {string|null} mode
   */
  async rebootDevice() {
    await exec(`${fastboot} reboot bootloader`);
    await exec(`${adb} wait-for-device`);
  }

  /**
   * Saves the bootloader code into a file.
   * The file name is code_{imei}.txt
   *
   * @param {number} code
   */
  async saveBootloaderCode(code) {
    writeFileSync(`code_${imei}.txt`, `The bootloader code for the device with IMEI ${imei} is: ${code}`);
  }

  /**
   * Saves the last state.
   * The file name is saved_state_{imei}.txt
   *
   * @param {number} code
   */
  async saveLastState(code) {
    writeFileSync(`saved_state_${imei}.txt`, code);
  }
}

const run = async () => {
  const bruteforce = new Bruteforce();

  await bruteforce.start();
};

run();
