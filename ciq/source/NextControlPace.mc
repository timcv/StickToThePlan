//
// Next Control Pace: a generic, install-once Connect IQ data field. It reads
// the loaded course's control points live and shows, per segment between
// controls: next control, distance remaining, segment average speed, ETA, and
// +/- minutes versus the planned time parsed from the course-point name.
//
// Nothing about a specific plan is baked in; the plan reaches the watch through
// the course (course.fit) the rider loads.
//

import Toybox.Application;
import Toybox.Activity;
import Toybox.Lang;
import Toybox.Graphics;
import Toybox.System;
import Toybox.WatchUi;

class NextControlPaceView extends WatchUi.DataField {

    // Settings (re-read each compute()).
    private var mLayoutMode as Number = 0;   // 0 compact, 1 eta-only
    private var mUnits as Number = 0;         // 0 km/h, 1 mph
    private var mShowDelta as Boolean = true;

    // Segment state.
    private var mLastNextName as String? = null;
    private var mSegStartDist as Float = 0.0;
    private var mSegStartTimer as Number = 0; // ms
    private var mSegIndex as Number = 0;
    private var mLastDistToNext as Float = -1.0;
    private var mLockoutUntil as Number = 0;  // ms
    private var mShowPassedUntil as Number = 0; // ms
    private var mPassedName as String? = null;
    private var mSmoothedSpeed as Float = 0.0; // m/s
    private var mNowTimer as Number = 0;       // ms, last seen timerTime
    private var mNowElapsed as Number = 0;     // ms, total elapsed since start

    // Computed display values.
    private var mNextName as String? = null;
    private var mDistToNext as Float? = null;  // m
    private var mAvgSpeed as Float? = null;    // m/s (smoothed)
    private var mEtaClockSec as Number? = null;
    private var mDeltaMin as Number? = null;
    private var mStatus as String? = null;

    private const MIN_DIST = 500.0; // m
    private const MIN_TIME = 60;    // s
    private const LOCKOUT_MS = 8000;
    private const PASSED_MS = 6000;
    private const MS_TO_KMH = 3.6;       // m/s -> km/h
    private const MS_TO_MPH = 2.2369363; // m/s -> mph

    public function initialize() {
        DataField.initialize();
    }

    private function loadSettings() as Void {
        var app = Application.getApp();
        var lm = app.getProperty("layoutMode");
        if (lm != null) { mLayoutMode = lm as Number; }
        var u = app.getProperty("units");
        if (u != null) { mUnits = u as Number; }
        var sd = app.getProperty("showPlanDelta");
        if (sd != null) { mShowDelta = sd as Boolean; }
    }

    private function startSegment(name as String?, dist as Float, timer as Number) as Void {
        mLastNextName = name;
        mSegStartDist = dist;
        mSegStartTimer = timer;
        mSegIndex = mSegIndex + 1;
        mSmoothedSpeed = 0.0;
    }

    private function segmentChanged(name as String?, distToNext as Float?, nowTimer as Number) as Boolean {
        if (nowTimer < mLockoutUntil) { return false; }
        if (name != null && mLastNextName != null && !name.equals(mLastNextName)) { return true; }
        if (mLastDistToNext >= 0.0 && distToNext != null) {
            var d = distToNext as Float;
            if (mLastDistToNext < 50.0 && d > 500.0) { return true; }
            if (mLastDistToNext < 150.0 && (d - mLastDistToNext) > 1000.0) { return true; }
        }
        return false;
    }

    private function isDigit(c as Char) as Boolean {
        var v = c.toNumber();
        return v >= 48 && v <= 57;
    }

    private function digit(c as Char) as Number {
        return c.toNumber() - 48;
    }

    // First HH:MM (or H:MM) in the string -> seconds since midnight, else null.
    private function parsePlannedSec(name as String) as Number? {
        var chars = name.toCharArray();
        var n = chars.size();
        for (var i = 0; i < n; i++) {
            if (chars[i] == ':' && i + 2 < n && isDigit(chars[i + 1]) && isDigit(chars[i + 2])) {
                if (i - 1 < 0 || !isDigit(chars[i - 1])) { continue; }
                var hh = digit(chars[i - 1]);
                if (i - 2 >= 0 && isDigit(chars[i - 2])) {
                    hh = digit(chars[i - 2]) * 10 + hh;
                }
                var mm = digit(chars[i + 1]) * 10 + digit(chars[i + 2]);
                if (hh < 24 && mm < 60) { return hh * 3600 + mm * 60; }
            }
        }
        return null;
    }

    // A course-point name baked in relative mode carries a leading '+' on its
    // time token ("Gränna +2:42"); absolute mode has none ("Gränna 07:04").
    private function isRelativeName(name as String) as Boolean {
        var chars = name.toCharArray();
        for (var i = 0; i < chars.size(); i++) {
            if (chars[i] == '+') { return true; }
        }
        return false;
    }

    public function compute(info as Activity.Info) as Void {
        loadSettings();
        mStatus = null;

        var name = (info has :nameOfNextPoint) ? info.nameOfNextPoint : null;
        var distToNext = (info has :distanceToNextPoint) ? info.distanceToNextPoint : null;
        var elapsedDist = (info has :elapsedDistance) ? info.elapsedDistance : null;
        var timer = (info has :timerTime) ? info.timerTime : null;
        var elapsedT = (info has :elapsedTime) ? info.elapsedTime : null;
        var curSpeed = (info has :currentSpeed) ? info.currentSpeed : null;

        if (name == null && distToNext == null) {
            mStatus = "Ingen bana";
            mNextName = null; mDistToNext = null; mAvgSpeed = null;
            mEtaClockSec = null; mDeltaMin = null;
            return;
        }
        if (elapsedDist == null || timer == null) {
            mStatus = "Väntar på navigation";
            return;
        }

        mNowTimer = timer as Number;
        // Total time since start (includes pauses), so the relative-mode delta
        // mirrors wall-clock and is unaffected by auto-pause. Falls back to the
        // timer when elapsedTime is unavailable.
        mNowElapsed = (elapsedT != null) ? (elapsedT as Number) : mNowTimer;
        var ed = elapsedDist as Float;

        if (mSegIndex == 0) {
            startSegment(name, ed, mNowTimer);
        }

        if (segmentChanged(name, distToNext, mNowTimer)) {
            mPassedName = mLastNextName;
            mShowPassedUntil = mNowTimer + PASSED_MS;
            startSegment(name, ed, mNowTimer);
            mLockoutUntil = mNowTimer + LOCKOUT_MS;
        }

        mLastNextName = name;
        if (distToNext != null) { mLastDistToNext = distToNext as Float; }

        mNextName = name;
        mDistToNext = (distToNext != null) ? distToNext as Float : null;

        var distDone = ed - mSegStartDist;
        var timeDone = (mNowTimer - mSegStartTimer) / 1000.0;
        if (distDone < MIN_DIST || timeDone < MIN_TIME) {
            mStatus = "Bygger snitt...";
            mAvgSpeed = null; mEtaClockSec = null; mDeltaMin = null;
            return;
        }

        var avg = distDone / timeDone;
        if (mSmoothedSpeed <= 0.0) { mSmoothedSpeed = avg; }
        else { mSmoothedSpeed = 0.9 * mSmoothedSpeed + 0.1 * avg; }
        mAvgSpeed = mSmoothedSpeed;

        var speedForEta = mSmoothedSpeed;
        if (speedForEta <= 0.0 && curSpeed != null) { speedForEta = curSpeed as Float; }

        if (mDistToNext != null && speedForEta > 0.0) {
            var etaSec = (mDistToNext as Float) / speedForEta;
            var clk = System.getClockTime();
            var nowSec = clk.hour * 3600 + clk.min * 60 + clk.sec;
            var etaClock = (nowSec + etaSec.toNumber()) % 86400;
            mEtaClockSec = etaClock;

            if (mShowDelta && name != null) {
                var planned = parsePlannedSec(name);
                if (planned != null) {
                    var d;
                    if (isRelativeName(name)) {
                        // Plan time is elapsed-since-start: compare projected
                        // elapsed at the control to our own elapsed time, so the
                        // delta is correct whatever clock time we started at.
                        var elapsedSec = mNowElapsed / 1000;
                        d = (elapsedSec + etaSec.toNumber()) - (planned as Number);
                    } else {
                        // Plan time is wall-clock: compare projected arrival clock.
                        d = etaClock - (planned as Number);
                        if (d > 43200) { d -= 86400; }
                        if (d < -43200) { d += 86400; }
                    }
                    mDeltaMin = (d / 60.0).toNumber();
                } else {
                    mDeltaMin = null;
                }
            } else {
                mDeltaMin = null;
            }
        } else {
            mEtaClockSec = null;
            mDeltaMin = null;
        }
    }

    // ----- formatting helpers -----

    private function fmtKm(distM as Float?) as String {
        if (distM == null) { return "-- km"; }
        var km = (distM as Float) / 1000.0;
        return km.format("%.1f") + " km";
    }

    private function speedVal(ms as Float?) as Float {
        if (ms == null) { return 0.0; }
        return (mUnits == 1) ? (ms as Float) * MS_TO_MPH : (ms as Float) * MS_TO_KMH;
    }

    private function speedUnit() as String {
        return (mUnits == 1) ? "mph" : "km/h";
    }

    private function fmtSpeed(ms as Float?) as String {
        if (ms == null) { return "--"; }
        return speedVal(ms).format("%.1f");
    }

    private function fmtClock(sec as Number?) as String {
        if (sec == null) { return "--:--"; }
        var s = sec as Number;
        return (s / 3600).format("%02d") + ":" + ((s % 3600) / 60).format("%02d");
    }

    private function fmtDelta(min as Number?) as String {
        if (min == null) { return ""; }
        var m = min as Number;
        var sign = (m < 0) ? "-" : "+";
        var a = (m < 0) ? -m : m;
        return sign + a.format("%02d");
    }

    private function deltaColor(min as Number?, fg as Number, bg as Number) as Number {
        if (min == null) { return fg; }
        var a = (min as Number);
        if (a < 0) { a = -a; }
        // Darker variants on light backgrounds so the accent stays legible.
        var dark = (bg == Graphics.COLOR_BLACK);
        if (a <= 2) { return dark ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GREEN; }
        if (a <= 10) { return dark ? Graphics.COLOR_YELLOW : Graphics.COLOR_ORANGE; }
        return dark ? Graphics.COLOR_RED : Graphics.COLOR_DK_RED;
    }

    private function nameUpper() as String {
        return (mNextName != null) ? (mNextName as String).toUpper() : "?";
    }

    // Draw an evenly spaced vertical stack of [text, font, color] rows.
    private function drawStack(dc as Dc, rows as Array) as Void {
        var cx = dc.getWidth() / 2;
        var step = dc.getHeight() / (rows.size() + 1);
        for (var i = 0; i < rows.size(); i++) {
            var r = rows[i] as Array;
            dc.setColor(r[2] as Number, Graphics.COLOR_TRANSPARENT);
            dc.drawText(
                cx, step * (i + 1), r[1] as Graphics.FontDefinition, r[0] as String,
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    public function onUpdate(dc as Dc) as Void {
        var bg = getBackgroundColor();
        var fg = (bg == Graphics.COLOR_BLACK) ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;
        dc.setColor(bg, bg);
        dc.clear();

        var nm = Graphics.FONT_NUMBER_MEDIUM;
        var big = Graphics.FONT_NUMBER_HOT;
        var med = Graphics.FONT_MEDIUM;
        var tiny = Graphics.FONT_TINY;
        // Theme-aware accent colours so the field reads on both light and dark
        // data screens: greyed labels, a blue speed accent, white/black hero.
        var label = (bg == Graphics.COLOR_BLACK) ? Graphics.COLOR_LT_GRAY : Graphics.COLOR_DK_GRAY;
        var blue = Graphics.COLOR_BLUE;

        // Passed confirmation takes over briefly after a segment switch.
        if (mNowTimer < mShowPassedUntil) {
            var passedFrom = (mPassedName != null) ? (mPassedName as String).toUpper() : "";
            var nextTo = (mNextName != null) ? (mNextName as String).toUpper() : "";
            drawStack(dc, [
                ["✓", nm, Graphics.COLOR_GREEN],
                [passedFrom + " Passerad!", med, fg],
                ["Nästa: " + nextTo, tiny, label],
                [fmtKm(mDistToNext), med, fg]]);
            return;
        }

        // Status / fallback states.
        if (mStatus != null) {
            if ((mStatus as String).equals("Bygger snitt...")) {
                drawStack(dc, [[nameUpper(), tiny, label], [fmtKm(mDistToNext), nm, fg], [mStatus as String, tiny, label]]);
            } else if ((mStatus as String).equals("Ingen bana")) {
                drawStack(dc, [[mStatus as String, med, fg], ["Starta navigation", tiny, fg]]);
            } else {
                drawStack(dc, [[mStatus as String, med, fg]]);
            }
            return;
        }

        var dCol = deltaColor(mDeltaMin, fg, bg);

        if (mLayoutMode == 1) {
            // ETA: big finish clock with coloured plan delta.
            drawStack(dc, [
                ["ETA", tiny, label],
                [fmtClock(mEtaClockSec), big, fg],
                [fmtDelta(mDeltaMin) + " min", med, dCol],
                ["TILL " + nameUpper(), tiny, label]]);
        } else {
            // Compact (default): big distance + big blue speed, plan footer.
            drawStack(dc, [
                [nameUpper(), tiny, label],
                [fmtKm(mDistToNext), big, fg],
                [fmtSpeed(mAvgSpeed), nm, blue],
                ["ETA " + fmtClock(mEtaClockSec) + " | " + fmtDelta(mDeltaMin), tiny, fg]]);
        }
    }
}

class NextControlPaceApp extends Application.AppBase {

    public function initialize() {
        AppBase.initialize();
    }

    public function onStart(state as Dictionary?) as Void {
    }

    public function onStop(state as Dictionary?) as Void {
    }

    public function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        return [new $.NextControlPaceView()];
    }
}
