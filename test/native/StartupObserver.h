#pragma once

#include "StartupProcess.h"
#include <objbase.h>
#include <evntrace.h>
#include <evntcons.h>
#include <tdh.h>
#include <shellapi.h>
#include <atomic>
#include <array>
#include <climits>
#include <cstring>
#include <filesystem>
#include <map>
#include <memory>
#include <ostream>
#include <mutex>
#include <set>
#include <system_error>
#include <thread>

namespace proof {
inline void check(bool value, const char* message) {
    if (!value) throw std::runtime_error(message);
}

inline void pump(DWORD milliseconds = 20) {
    MsgWaitForMultipleObjects(0, nullptr, FALSE, milliseconds, QS_ALLINPUT);
    MSG message{};
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
}

template<class Predicate>
void until(Predicate predicate, const char* failure, DWORD timeout = 15000) {
    const auto deadline = GetTickCount64() + timeout;
    do {
        if (predicate()) return;
        pump();
    } while (GetTickCount64() < deadline);
    throw std::runtime_error(failure);
}

inline std::wstring imagePath(HANDLE process) {
    std::vector<wchar_t> buffer(32768);
    DWORD size = static_cast<DWORD>(buffer.size());
    if (!QueryFullProcessImageNameW(process, 0, buffer.data(), &size))
        throw std::system_error(static_cast<int>(GetLastError()), std::system_category(), "process-image-query");
    return recap::normalizedPath({ buffer.data(), size });
}

inline void nativeArchitecture(HANDLE process) {
    USHORT emulated = 0, native = 0;
    if (!IsWow64Process2(process, &emulated, &native))
        throw std::system_error(static_cast<int>(GetLastError()), std::system_category(), "process-architecture-query");
#if defined(_M_ARM64)
    check(native == IMAGE_FILE_MACHINE_ARM64 && emulated == IMAGE_FILE_MACHINE_UNKNOWN, "ARM64 proof is not native");
#else
    check(native == IMAGE_FILE_MACHINE_AMD64 && emulated == IMAGE_FILE_MACHINE_UNKNOWN, "x64 proof is not native");
#endif
}

inline bool hasConsole(HANDLE process, DWORD pid) {
    check(WaitForSingleObject(process, 0) == WAIT_TIMEOUT, "console probe target was not alive");
    if (GetConsoleWindow()) check(FreeConsole() != FALSE, "observer could not detach its own console");
    if (AttachConsole(pid)) {
        check(FreeConsole() != FALSE, "observer could not detach target console");
        return true;
    }
    const auto error = GetLastError();
    check(error == ERROR_INVALID_HANDLE && WaitForSingleObject(process, 0) == WAIT_TIMEOUT,
          "console attachment was inconclusive");
    return false;
}

enum class Rundown { none, begin, end };
enum class LifecycleKind { start, end, rundownBegin, rundownEnd };

struct LifecycleEvent {
    DWORD id = 0, owner = 0;
    LONGLONG timestamp = 0;
    LifecycleKind kind = LifecycleKind::start;
};

struct LifetimeRange {
    size_t first = 0, last = SIZE_MAX;
    DWORD id = 0, owner = 0;
    LONGLONG begin = 0, until = LLONG_MAX;
    bool created = false, ended = false, ambiguous = false, rundownBegin = false, rundownEnd = false;
};

inline std::vector<LifetimeRange> lifetimeRanges(const std::vector<LifecycleEvent>& events, size_t limit) {
    std::vector<size_t> order;
    for (size_t index = 0; index < events.size(); ++index) order.push_back(index);
    std::stable_sort(order.begin(), order.end(), [&](size_t a, size_t b) {
        if (events[a].timestamp != events[b].timestamp) return events[a].timestamp < events[b].timestamp;
        return events[a].kind == LifecycleKind::start && events[b].kind != LifecycleKind::start;
    });
    std::vector<LifetimeRange> result;
    std::map<DWORD, std::vector<size_t>> identities;
    for (const auto row : order) {
        const auto& event = events[row];
        auto& entries = identities[event.id];
        std::vector<size_t> active;
        for (const auto index : entries)
            if (result[index].begin <= event.timestamp && event.timestamp <= result[index].until) active.push_back(index);
        if (event.kind == LifecycleKind::end) {
            if (active.empty()) {
                if (!entries.empty()) result[entries.back()].ambiguous = true;
                check(result.size() < limit, "lifetime identity bound exceeded");
                LifetimeRange missing;
                missing.first = missing.last = row;
                missing.id = event.id;
                missing.owner = event.owner;
                missing.begin = missing.until = event.timestamp;
                missing.ended = missing.ambiguous = true;
                entries.push_back(result.size());
                result.push_back(missing);
                continue;
            }
            for (const auto index : active) {
                auto& value = result[index];
                value.ambiguous = value.ambiguous || value.ended || active.size() != 1 || value.owner != event.owner;
                value.last = row;
                value.until = event.timestamp;
                value.ended = true;
            }
            continue;
        }
        if (event.kind != LifecycleKind::start && !active.empty()) {
            for (const auto index : active) {
                auto& value = result[index];
                auto& observed = event.kind == LifecycleKind::rundownBegin ? value.rundownBegin : value.rundownEnd;
                value.ambiguous = value.ambiguous || value.ended || active.size() != 1 || observed ||
                    value.owner != event.owner;
                observed = true;
            }
            continue;
        }
        check(result.size() < limit, "lifetime identity bound exceeded");
        LifetimeRange value;
        value.first = row;
        value.id = event.id;
        value.owner = event.owner;
        value.begin = event.timestamp;
        value.created = event.kind == LifecycleKind::start;
        value.rundownBegin = event.kind == LifecycleKind::rundownBegin;
        value.rundownEnd = event.kind == LifecycleKind::rundownEnd;
        value.ambiguous = !event.id || event.timestamp <= 0 || !active.empty();
        for (const auto index : active) result[index].ambiguous = true;
        entries.push_back(result.size());
        result.push_back(value);
    }
    return result;
}

struct ProcessEvent {
    DWORD pid = 0, parent = 0;
    bool start = false;
    LONGLONG timestamp = 0;
    std::wstring image, command;
    bool exitKnown = false;
    DWORD exitCode = 0;
    Rundown rundown = Rundown::none;
    UCHAR version = 0;
    std::wstring diagnosticCommand;
};

struct ProcessImage {
    DWORD pid = 0;
    LONGLONG timestamp = 0;
    std::wstring path;
    Rundown rundown = Rundown::none;
};

struct ProcessInstance {
    ProcessEvent start, end;
    size_t startRow = 0;
    LONGLONG until = LLONG_MAX;
    bool ended = false, ambiguous = false;
    bool creationObserved = false, rundownBegin = false, rundownEnd = false;
};

struct ProcessGraph {
    std::vector<ProcessInstance> instances;
    explicit ProcessGraph(const std::vector<ProcessEvent>& events) {
        std::vector<LifecycleEvent> records;
        for (const auto& event : events) {
            const auto kind = event.rundown == Rundown::begin ? LifecycleKind::rundownBegin
                : event.rundown == Rundown::end ? LifecycleKind::rundownEnd
                : event.start ? LifecycleKind::start : LifecycleKind::end;
            records.push_back({ event.pid, event.parent, event.timestamp, kind });
        }
        for (const auto& range : lifetimeRanges(records, 8192)) {
            ProcessInstance value;
            value.start = events[range.first];
            if (range.ended) value.end = events[range.last];
            value.startRow = range.first;
            value.until = range.until;
            value.ended = range.ended;
            value.ambiguous = range.ambiguous;
            value.creationObserved = range.created;
            value.rundownBegin = range.rundownBegin;
            value.rundownEnd = range.rundownEnd;
            instances.push_back(std::move(value));
        }
    }
    std::vector<size_t> at(DWORD pid, LONGLONG time) const {
        std::vector<size_t> result;
        for (size_t index = 0; index < instances.size(); ++index) {
            const auto& value = instances[index];
            if (value.start.pid == pid && value.start.timestamp <= time && time <= value.until) result.push_back(index);
        }
        return result;
    }
    size_t unique(DWORD pid, LONGLONG time) const {
        const auto candidates = at(pid, time);
        return candidates.size() == 1 && !instances[candidates[0]].ambiguous ? candidates[0] : SIZE_MAX;
    }
    size_t exact(DWORD pid, LONGLONG start) const {
        size_t result = SIZE_MAX;
        for (size_t index = 0; index < instances.size(); ++index) {
            const auto& value = instances[index];
            if (value.start.pid != pid || value.start.timestamp != start) continue;
            if (result != SIZE_MAX || value.ambiguous) return SIZE_MAX;
            result = index;
        }
        return result;
    }
    struct Lineage {
        std::set<size_t> owned;
        size_t ambiguous = SIZE_MAX, missingParent = SIZE_MAX;
    };
    Lineage descendants(const std::set<size_t>& roots) const {
        Lineage result{ roots };
        for (const auto root : roots) {
            if (root >= instances.size() || instances[root].ambiguous) { result.ambiguous = root; return result; }
        }
        for (size_t turn = 0; turn <= instances.size(); ++turn) {
            bool changed = false;
            std::set<DWORD> ownedPids;
            for (const auto item : result.owned) ownedPids.insert(instances[item].start.pid);
            for (size_t index = 0; index < instances.size(); ++index) {
                if (roots.count(index)) continue;
                const auto& value = instances[index];
                if (!value.creationObserved) continue;
                const auto parents = at(value.start.parent, value.start.timestamp);
                const bool related = std::any_of(parents.begin(), parents.end(),
                    [&](size_t parent) { return result.owned.count(parent) != 0; });
                if (related && (parents.size() != 1 || value.ambiguous || instances[parents[0]].ambiguous)) {
                    result.ambiguous = index;
                    return result;
                }
                if (parents.empty() && ownedPids.count(value.start.parent)) {
                    result.missingParent = index;
                    return result;
                }
                if (related && result.owned.insert(index).second) changed = true;
            }
            if (!changed) break;
        }
        return result;
    }
};

inline constexpr size_t ThreadRecordLimit = 65536, ThreadIdentityLimit = 32768;

struct ThreadEvent {
    DWORD pid = 0, tid = 0;
    LONGLONG timestamp = 0;
    LifecycleKind kind = LifecycleKind::start;
    UCHAR version = 0;
};

inline void appendThreadEvent(std::vector<ThreadEvent>& events, const ThreadEvent& event) {
    check(events.size() < ThreadRecordLimit, "ETW thread record bound exceeded");
    events.push_back(event);
}

struct ThreadGraph {
    std::vector<LifetimeRange> instances;
    explicit ThreadGraph(const std::vector<ThreadEvent>& events) {
        check(events.size() <= ThreadRecordLimit, "ETW thread record bound exceeded");
        std::vector<LifecycleEvent> records;
        for (const auto& event : events) records.push_back({ event.tid, event.pid, event.timestamp, event.kind });
        instances = lifetimeRanges(records, ThreadIdentityLimit);
    }
    std::vector<size_t> between(DWORD tid, LONGLONG begin, LONGLONG end) const {
        std::vector<size_t> result;
        for (size_t index = 0; index < instances.size(); ++index) {
            const auto& value = instances[index];
            if (value.id == tid && value.begin <= end && value.until >= begin) result.push_back(index);
        }
        return result;
    }
    size_t unique(DWORD tid, LONGLONG time) const {
        const auto candidates = between(tid, time, time);
        return candidates.size() == 1 && !instances[candidates[0]].ambiguous ? candidates[0] : SIZE_MAX;
    }
};

struct FinalObservationFailure : std::runtime_error {
    const char* code;
    const char* stage;
    FinalObservationFailure(const char* condition, const char* section)
        : std::runtime_error(condition), code(condition), stage(section) {}
};

inline constexpr const char* FinalConditions[] = {
    "final-capture-not-stopped", "final-capture-unhealthy", "final-clock-invalid", "final-control-count",
    "final-root-count-mismatch", "final-root-registration-missing", "final-root-pid-mismatch",
    "final-root-instance-missing", "final-root-instance-ambiguous", "final-root-image-mismatch", "final-root-exit-mismatch",
    "final-root-retained-instance-missing", "final-lineage-ambiguous", "final-parent-interval-missing",
    "final-system-root-unavailable", "final-coordinator-image-mismatch", "final-coordinator-arguments",
    "final-coordinator-exit-missing", "final-server-image-mismatch", "final-verifier-image-mismatch",
    "final-verifier-exit-missing", "final-browser-image-mismatch", "final-browser-origin-mismatch",
    "final-browser-exit-missing", "final-coordinator-role-missing", "final-installed-roles-missing",
    "final-calibration-lifetime-invalid", "final-console-binding-unresolved", "final-window-scope-inconclusive", "final-visible-product-terminal",
    "final-context-exception"
};

enum class RegisteredPurpose { observer, visual, product };
enum class ObservationProfile { calibration, nativeFixture, installedFunctionality, installedBusy, diagnostic };

inline const char* profileName(ObservationProfile profile) {
    switch (profile) {
    case ObservationProfile::calibration: return "calibration";
    case ObservationProfile::nativeFixture: return "native-fixed-fixture";
    case ObservationProfile::installedFunctionality: return "installed-functionality";
    case ObservationProfile::installedBusy: return "installed-busy";
    default: return "diagnostic";
    }
}

inline bool nativeEnvironmentAllowed(ObservationProfile profile, bool fixedSource, bool instanceKnown,
                                     bool exactOutsideImage, bool controlledRelation, bool ownedAssociation) {
    // The pinned fixture only spawns process.execPath; installed activation can use shell brokers.
    return profile == ObservationProfile::nativeFixture && fixedSource && instanceKnown && exactOutsideImage &&
        !controlledRelation && !ownedAssociation;
}

inline const char* purposeName(RegisteredPurpose purpose) {
    switch (purpose) {
    case RegisteredPurpose::observer: return "registered-observer";
    case RegisteredPurpose::visual: return "registered-visual-helper";
    default: return "registered-product-root";
    }
}

struct Moment {
    uint64_t tick = 0, qpc = 0, afterQpc = 0;
};

inline Moment moment() {
    LARGE_INTEGER counter{}, after{};
    check(QueryPerformanceCounter(&counter) != FALSE, "performance clock unavailable");
    const auto tick = GetTickCount64();
    check(QueryPerformanceCounter(&after) != FALSE, "performance clock unavailable");
    return { tick, static_cast<uint64_t>(counter.QuadPart), static_cast<uint64_t>(after.QuadPart) };
}

enum class WindowKind { unknown, other, startup, console, terminal };
enum class PresenterRole { unknown, other, classic };

inline const char* presenterRoleName(PresenterRole role) {
    return role == PresenterRole::classic ? "trusted-classic-host" : role == PresenterRole::other ? "other" : "unknown";
}

inline const char* windowKindName(WindowKind kind) {
    switch (kind) {
    case WindowKind::other: return "other";
    case WindowKind::startup: return "startup";
    case WindowKind::console: return "console";
    case WindowKind::terminal: return "terminal";
    default: return "unknown";
    }
}

struct WindowFact {
    DWORD event = 0, owner = 0, thread = 0, callbackThread = 0;
    DWORD sourceThread = 0, sourceOwner = 0, sourceError = 0, generated32 = 0;
    LONG object = 0, child = 0;
    uintptr_t window = 0;
    uint64_t generated = 0;
    Moment received;
    WindowKind kind = WindowKind::unknown;
    bool metadataKnown = false, present = false, visible = false, topLevel = false, onScreen = false;
    bool identityKnown = false, geometryKnown = false, hierarchyKnown = false;
    uint64_t sourceThreadCreation = 0;
    size_t sourceActor = 0, reportedActor = 0;
    bool sourceThreadKnown = false, sourceRetained = false;
    uint64_t sourceObservedQpc = 0;
    bool sourceLive = false;
    RECT rectangle{};
};

inline constexpr uint64_t SourceClockSlopMs = 32;

struct SourceWitness {
    DWORD pid = 0, tid = 0;
    uint64_t processCreation = 0, threadCreation = 0, observedQpc = 0, liveThroughQpc = 0;
};

struct SourceResolution {
    DWORD owner = 0;
    size_t process = SIZE_MAX, thread = SIZE_MAX;
    uint64_t threadCreation = 0;
    bool known = false, retained = false, liveQuery = false, rundown = false;
    LONGLONG earliest = 0, latest = 0;
    const char* reason = "source-interval-missing";
};

inline SourceResolution resolveSource(const WindowFact& raw, const ProcessGraph& processes,
                                      const ThreadGraph& threads, const std::vector<SourceWitness>& retained,
                                      uint64_t captureBegin, uint64_t frequency, bool clocks, bool healthy) {
    SourceResolution result;
    if (!clocks || !healthy || !raw.sourceThread || !frequency || !captureBegin ||
        raw.received.afterQpc < raw.received.qpc || raw.received.afterQpc > static_cast<uint64_t>(LLONG_MAX) ||
        raw.generated > raw.received.tick || raw.received.tick - raw.generated > 120000 ||
        frequency > static_cast<uint64_t>(LLONG_MAX) / (120000 + SourceClockSlopMs)) {
        result.reason = "source-clock-or-capture-invalid";
        return result;
    }
    const auto delay = raw.received.tick - raw.generated;
    // Two coarse uptime readings bracket a QPC interval, not one invented event instant.
    const auto before = (delay + SourceClockSlopMs) * frequency / 1000;
    const auto after = delay > SourceClockSlopMs ? (delay - SourceClockSlopMs) * frequency / 1000 : 0;
    if (raw.received.qpc <= before || raw.received.afterQpc < after) return result;
    const auto earliest = raw.received.qpc - before;
    const auto latest = std::min(raw.received.qpc, raw.received.afterQpc - after);
    if (earliest < captureBegin || latest < earliest) return result;
    result.earliest = static_cast<LONGLONG>(earliest);
    result.latest = static_cast<LONGLONG>(latest);
    const auto candidates = threads.between(raw.sourceThread, result.earliest, result.latest);
    if (candidates.size() != 1 || threads.instances[candidates[0]].ambiguous) {
        result.reason = candidates.empty() ? "source-thread-lifetime-missing" : "source-thread-lifetime-ambiguous";
        return result;
    }
    result.thread = candidates[0];
    const auto& thread = threads.instances[result.thread];
    std::vector<size_t> owners;
    for (size_t index = 0; index < processes.instances.size(); ++index) {
        const auto& value = processes.instances[index];
        if (value.start.pid == thread.owner && value.start.timestamp <= result.latest &&
            value.until >= std::max(thread.begin, result.earliest)) owners.push_back(index);
    }
    if (owners.size() != 1 || processes.instances[owners[0]].ambiguous) {
        result.reason = "source-process-lifetime-missing-or-ambiguous";
        return result;
    }
    result.process = owners[0];
    const auto& process = processes.instances[result.process];
    if (!thread.owner || (raw.sourceOwner && raw.sourceOwner != thread.owner) ||
        (process.creationObserved && process.start.timestamp > thread.begin)) {
        result.reason = "source-owner-instance-conflict";
        return result;
    }
    const auto point = std::max(thread.begin, process.start.timestamp);
    uint64_t processCreation = 0;
    for (const auto& witness : retained) {
        if (witness.pid != thread.owner || witness.tid != raw.sourceThread || !witness.processCreation ||
            !witness.threadCreation || !witness.observedQpc || witness.observedQpc > witness.liveThroughQpc) continue;
        const auto witnessed = std::max(static_cast<LONGLONG>(witness.observedQpc), point);
        if (witnessed > static_cast<LONGLONG>(witness.liveThroughQpc) ||
            threads.unique(witness.tid, witnessed) != result.thread ||
            processes.unique(witness.pid, witnessed) != result.process) continue;
        if ((processCreation && processCreation != witness.processCreation) ||
            (result.threadCreation && result.threadCreation != witness.threadCreation) ||
            (raw.sourceThreadKnown && raw.sourceThreadCreation != witness.threadCreation)) {
            result.reason = "source-retained-creation-conflict";
            return result;
        }
        processCreation = witness.processCreation;
        result.threadCreation = witness.threadCreation;
        result.retained = true;
    }
    if (raw.sourceThreadKnown && raw.sourceLive) {
        if (!raw.sourceObservedQpc || threads.unique(raw.sourceThread, static_cast<LONGLONG>(raw.sourceObservedQpc)) != result.thread ||
            processes.unique(raw.sourceOwner, static_cast<LONGLONG>(raw.sourceObservedQpc)) != result.process) {
            result.reason = "source-live-query-instance-conflict";
            return result;
        }
        result.threadCreation = raw.sourceThreadCreation;
        result.liveQuery = true;
    }
    result.owner = thread.owner;
    result.known = true;
    result.rundown = thread.rundownBegin || thread.rundownEnd || process.rundownBegin || process.rundownEnd;
    result.reason = result.retained ? "retained-source-identity"
        : result.liveQuery ? "live-source-query" : "source-lifecycle-recovery";
    return result;
}

inline constexpr size_t SemanticOperationLimit = 256, SemanticRecordLimit = 16384;
inline constexpr wchar_t SemanticAumid[] = L"PanelStackLabs.RecapPage_we33aa8nvkpcc!App";
inline constexpr wchar_t SemanticListenerScript[] = LR"SEM($row = Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq 8787 } | Select-Object -First 1; if ($row) { $row.OwningProcess })SEM";
inline constexpr wchar_t SemanticPackagePrefix[] = L"$since = [datetime]'";
inline constexpr wchar_t SemanticPackageSuffix[] = LR"SEM('; $rows = Get-CimInstance Win32_Process | ForEach-Object { $created = [datetime]$_.CreationDate; if ($created -ge $since) { [pscustomobject]@{ Name = $_.Name; ProcessId = $_.ProcessId; ParentProcessId = $_.ParentProcessId; ExecutablePath = $_.ExecutablePath; CreationDate = $created.ToString("o"); CommandLine = $_.CommandLine } } }; @($rows) | ConvertTo-Json -Compress)SEM";
inline constexpr wchar_t SemanticPackageInfoScript[] = LR"SEM($p = Get-AppxPackage -Name 'PanelStackLabs.RecapPage' | Where-Object PackageFamilyName -eq 'PanelStackLabs.RecapPage_we33aa8nvkpcc' | Sort-Object Version -Descending | Select-Object -First 1; if (-not $p) { "null"; exit 0 }; $p | Select-Object Name,PackageFullName,PackageFamilyName,InstallLocation,Version | ConvertTo-Json -Compress)SEM";
inline constexpr wchar_t SemanticBrowserScript[] = LR"SEM($names = "msedge","chrome","firefox"; $rows = Get-Process -Name $names -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object Id,ProcessName,MainWindowHandle,MainWindowTitle; @($rows) | ConvertTo-Json -Compress)SEM";

inline std::vector<std::wstring> semanticArguments(const std::wstring& command) {
    if (command.empty() || command.size() > 32768) return {};
    int count = 0;
    auto* values = CommandLineToArgvW(command.c_str(), &count);
    check(values != nullptr, "semantic command arguments unavailable");
    std::unique_ptr<void, decltype(&LocalFree)> allocation(values, &LocalFree);
    check(count > 0 && count <= 64, "semantic command argument bound exceeded");
    std::vector<std::wstring> result;
    for (int index = 0; index < count; ++index) result.emplace_back(values[index]);
    check(LocalFree(allocation.release()) == nullptr, "semantic command allocation cleanup failed");
    return result;
}

inline bool semanticFixedScript(const std::string& operation, const std::wstring& script) {
    if (operation == "aumid-activate")
        return script == std::wstring(L"Start-Process explorer.exe -ArgumentList 'shell:AppsFolder\\") + SemanticAumid + L"'";
    if (operation == "listener-query") return script == SemanticListenerScript;
    if (operation == "package-info-query") return script == SemanticPackageInfoScript;
    if (operation == "browser-snapshot-query") return script == SemanticBrowserScript;
    if (operation == "package-process-query") {
        const std::wstring prefix(SemanticPackagePrefix), suffix(SemanticPackageSuffix);
        if (script.size() != prefix.size() + 24 + suffix.size() || script.compare(0, prefix.size(), prefix) ||
            script.compare(prefix.size() + 24, suffix.size(), suffix)) return false;
        const auto date = script.substr(prefix.size(), 24);
        const std::wstring shape = L"0000-00-00T00:00:00.000Z";
        for (size_t index = 0; index < shape.size(); ++index)
            if (shape[index] == L'0' ? date[index] < L'0' || date[index] > L'9' : date[index] != shape[index]) return false;
        return true;
    }
    if (operation == "process-exists-query") {
        const std::wstring prefix = L"if (Get-Process -Id ";
        const std::wstring suffix = LR"SEM( -ErrorAction SilentlyContinue) { "true" } else { "false" })SEM";
        if (script.size() <= prefix.size() + suffix.size() || script.compare(0, prefix.size(), prefix) ||
            script.compare(script.size() - suffix.size(), suffix.size(), suffix)) return false;
        const auto pid = script.substr(prefix.size(), script.size() - prefix.size() - suffix.size());
        if (pid.size() > 10 || pid.front() == L'0') return false;
        uint64_t number = 0;
        for (const auto digit : pid) {
            if (digit < L'0' || digit > L'9') return false;
            number = number * 10 + static_cast<unsigned int>(digit - L'0');
        }
        return number <= MAXDWORD;
    }
    return false;
}

struct SemanticOperation {
    size_t ordinal = 0;
    std::string name;
    std::wstring script;
    uint64_t begin = 0, end = 0;
    bool ended = false, succeeded = false;
};

struct SemanticBinding {
    size_t process = SIZE_MAX, candidates = 0;
    bool fixedScript = false;
    const char* reason = "caller-unbound";
};

template<class ImageOf>
inline SemanticBinding bindSemanticOperation(const ProcessGraph& graph, size_t caller, const SemanticOperation& operation,
                                             const std::wstring& powershell, ImageOf imageOf) {
    SemanticBinding result;
    result.fixedScript = semanticFixedScript(operation.name, operation.script);
    if (caller >= graph.instances.size() || graph.instances[caller].ambiguous) return result;
    if (!operation.ordinal || operation.ordinal > SemanticOperationLimit || !operation.ended ||
        !operation.begin || operation.end < operation.begin || !result.fixedScript) {
        result.reason = "operation-record-unproved";
        return result;
    }
    result.reason = "operation-child-unproved";
    const auto pid = graph.instances[caller].start.pid;
    for (size_t index = 0; index < graph.instances.size(); ++index) {
        const auto& value = graph.instances[index];
        if (!value.creationObserved || value.ambiguous || value.start.parent != pid ||
            value.start.timestamp < static_cast<LONGLONG>(operation.begin) ||
            value.start.timestamp > static_cast<LONGLONG>(operation.end) ||
            !value.ended || value.until > static_cast<LONGLONG>(operation.end) ||
            graph.unique(pid, value.start.timestamp) != caller || !recap::samePath(imageOf(index), powershell)) continue;
        const auto args = semanticArguments(value.start.diagnosticCommand);
        if (args.size() != 5 || args[1] != L"-NoProfile" || args[2] != L"-NonInteractive" ||
            args[3] != L"-Command" || args[4] != operation.script) continue;
        ++result.candidates;
        result.process = index;
    }
    if (result.candidates == 1) result.reason = "exact-operation-child";
    else {
        result.process = SIZE_MAX;
        if (result.candidates > 1) result.reason = "operation-child-ambiguous";
    }
    return result;
}

inline bool semanticSourceMatches(const ProcessGraph& graph, const ThreadGraph& threads,
                                   size_t process, const SourceResolution& source) {
    if (!source.known || source.process != process || process >= graph.instances.size() ||
        source.thread >= threads.instances.size()) return false;
    const auto& thread = threads.instances[source.thread];
    return !thread.ambiguous && thread.owner == graph.instances[process].start.pid &&
        thread.begin <= source.latest && thread.until >= source.earliest;
}

struct SemanticKnownImage {
    std::wstring path;
    const char* label = "image-unavailable";
    bool broker = false;
};

struct SemanticImage {
    const char* label = "image-unavailable";
    size_t opaque = 0;
    bool exact = false, broker = false;
};

struct SemanticImageGroups {
    std::vector<std::wstring> paths;
    SemanticImage classify(const std::wstring& path, const std::vector<SemanticKnownImage>& known) {
        if (path.size() < 4 || path[1] != L':' || path[2] != L'\\') return {};
        for (const auto& value : known)
            if (!value.path.empty() && recap::samePath(path, value.path)) return { value.label, 0, true, value.broker };
        for (size_t index = 0; index < paths.size(); ++index)
            if (recap::samePath(path, paths[index])) return { "unmatched-image", index + 1, true, false };
        check(paths.size() < 20, "semantic image context bound exceeded");
        paths.push_back(path);
        return { "unmatched-image", paths.size(), true, false };
    }
};

inline const char* semanticAssociation(bool operation, bool explorerRequest, bool operationChild,
                                       bool urlHelper, bool urlChild, bool broker) {
    return operation ? "exact-proof-operation"
        : explorerRequest ? "direct-explorer-request-delegation-unknown"
        : operationChild ? "direct-operation-child"
        : urlHelper ? "owned-cmd-url-request"
        : urlChild ? "direct-url-helper-child"
        : broker ? "shared-broker-request-unknown" : "activity-association-unknown";
}

struct HelperScopeEvidence {
    bool registered = false, instance = false, image = false, thread = false, ownerCompatible = false;
    bool productAssociation = false, terminalAssociation = false;
};

inline bool verifiedHelperSurface(const WindowFact& raw, const HelperScopeEvidence& evidence) {
    return evidence.registered && evidence.instance && evidence.image && evidence.thread && evidence.ownerCompatible &&
        !evidence.productAssociation && !evidence.terminalAssociation &&
        raw.kind != WindowKind::startup && raw.kind != WindowKind::console && raw.kind != WindowKind::terminal &&
        ((raw.event != EVENT_OBJECT_SHOW && !raw.visible) || (raw.metadataKnown && raw.kind == WindowKind::other));
}

inline WindowFact windowFact(HWND window) {
    WindowFact fact;
    fact.window = reinterpret_cast<uintptr_t>(window);
    fact.present = window && IsWindow(window);
    if (!fact.present) return fact;
    fact.thread = GetWindowThreadProcessId(window, &fact.owner);
    wchar_t name[128]{};
    const auto length = GetClassNameW(window, name, static_cast<int>(std::size(name)));
    fact.geometryKnown = GetWindowRect(window, &fact.rectangle) != FALSE;
    fact.identityKnown = length > 0 && fact.thread != 0 && fact.owner != 0;
    if (fact.identityKnown)
        fact.kind = wcscmp(name, L"RecapPageStartupWindow") == 0 ? WindowKind::startup
            : wcscmp(name, L"ConsoleWindowClass") == 0 ? WindowKind::console
            : wcscmp(name, L"CASCADIA_HOSTING_WINDOW_CLASS") == 0 ? WindowKind::terminal : WindowKind::other;
    fact.visible = IsWindowVisible(window) != FALSE;
    const auto root = GetAncestor(window, GA_ROOT);
    fact.hierarchyKnown = root != nullptr;
    fact.topLevel = root == window;
    fact.onScreen = fact.geometryKnown && fact.rectangle.right > fact.rectangle.left &&
        fact.rectangle.bottom > fact.rectangle.top &&
        MonitorFromRect(&fact.rectangle, MONITOR_DEFAULTTONULL) != nullptr;
    fact.metadataKnown = fact.identityKnown && fact.geometryKnown && fact.hierarchyKnown;
    return fact;
}

struct WindowResolution {
    size_t lifetime = 0, evidence = SIZE_MAX;
    uint64_t beginTick = 0, endTick = UINT64_MAX;
    DWORD owner = 0, thread = 0;
    WindowKind kind = WindowKind::unknown;
    bool identityKnown = false, derived = false, conflict = false, visibilityMissing = false;
    bool created = false, destroyed = false;
    bool consoleBound = false, completeControl = false, ambientConsole = false;
    DWORD presenter = 0, presenterThread = 0, client = 0;
    const char* reason = "missing-identity";
};

struct WindowLifetime {
    std::vector<size_t> rows;
    bool created = false, closed = false, conflict = false;
};

inline bool completeNonPresenterTransient(const std::vector<WindowFact>& facts, const WindowLifetime& life,
                                          const HelperScopeEvidence& evidence) {
    if (!evidence.registered || !evidence.instance || !evidence.image || !evidence.thread ||
        !evidence.ownerCompatible || evidence.productAssociation || evidence.terminalAssociation ||
        !life.created || !life.closed || life.conflict || life.rows.size() != 2) return false;
    const auto& created = facts[life.rows[0]];
    const auto& destroyed = facts[life.rows[1]];
    if (created.event != EVENT_OBJECT_CREATE || destroyed.event != EVENT_OBJECT_DESTROY) return false;
    for (const auto index : life.rows) {
        const auto& raw = facts[index];
        if (raw.visible || raw.kind == WindowKind::startup || raw.kind == WindowKind::console ||
            raw.kind == WindowKind::terminal) return false;
    }
    return true;
}

inline std::vector<WindowLifetime> windowLifetimes(const std::vector<WindowFact>& facts) {
    std::vector<WindowLifetime> lifetimes;
    std::map<uintptr_t, size_t> active;
    for (size_t index = 0; index < facts.size(); ++index) {
        const auto& fact = facts[index];
        auto found = active.find(fact.window);
        if (fact.event == EVENT_OBJECT_CREATE || found == active.end()) {
            const bool collision = found != active.end();
            if (collision) lifetimes[found->second].conflict = true;
            lifetimes.push_back({ {}, fact.event == EVENT_OBJECT_CREATE, false, collision });
            active[fact.window] = lifetimes.size() - 1;
            found = active.find(fact.window);
        }
        auto& lifetime = lifetimes[found->second];
        if (!lifetime.rows.empty()) {
            const auto& prior = facts[lifetime.rows.back()];
            if (fact.generated < prior.generated || fact.received.qpc < prior.received.qpc)
                lifetime.conflict = true;
        }
        lifetime.rows.push_back(index);
        if (fact.event == EVENT_OBJECT_DESTROY) {
            lifetime.closed = true;
            active.erase(found);
        }
    }
    return lifetimes;
}

struct ConsoleBinding {
    uintptr_t window = 0;
    size_t lifetime = 0, presenterActor = 0, clientActor = 0, observerActor = 0;
    DWORD presenter = 0, presenterThread = 0, client = 0, clientThread = 0, observer = 0, observerThread = 0;
    uint64_t sourceThreadCreation = 0, sampleTick = 0, clientEndTick = 0, departureQpc = 0;
    uint64_t observerEndTick = 0, detachQpc = 0;
    PresenterRole role = PresenterRole::unknown;
    bool presenterKnown = false, sourceThreadBound = false, presenterEtw = false;
    bool clientKnown = false, clientThreadBound = false, clientEtw = false, association = false, noOtherClients = false;
    bool control = false, membership = false, sampleMapped = false, observerKnown = false, observerAttached = false;
    bool clientEnded = false, departed = false, observerOnly = false, observerEnded = false, observerDetached = false;
    size_t clientStarts = 0, clientEnds = 0, observerStarts = 0, observerEnds = 0;
    bool ambient = false;
};

inline bool bindingReady(const ConsoleBinding& binding) {
    return binding.window && binding.lifetime && binding.role == PresenterRole::classic &&
        binding.presenterKnown && binding.sourceThreadBound && binding.presenterEtw &&
        binding.presenterActor && binding.presenter && binding.presenterThread && binding.sourceThreadCreation &&
        binding.clientKnown && binding.clientThreadBound && binding.clientEtw &&
        binding.clientActor && binding.client && binding.clientThread && binding.association && binding.noOtherClients &&
        (!binding.control || (binding.membership && binding.sampleMapped && binding.observerKnown &&
                              binding.observerActor && binding.observerAttached));
}

inline bool ambientConsoleScoped(ObservationProfile profile, bool fixedSource, const ConsoleBinding& binding) {
    return profile == ObservationProfile::nativeFixture && fixedSource && binding.ambient && !binding.control &&
        bindingReady(binding);
}

inline std::vector<WindowResolution> correlateWindows(const std::vector<WindowFact>& facts,
                                                      bool clocks, bool captureHealthy,
                                                      const std::vector<ConsoleBinding>& bindings = {}) {
    const auto lifetimes = windowLifetimes(facts);
    std::vector<WindowResolution> result(facts.size());
    for (size_t number = 0; number < lifetimes.size(); ++number) {
        const auto& lifetime = lifetimes[number];
        for (const auto index : lifetime.rows) {
            auto& row = result[index];
            row.lifetime = number + 1;
            row.created = lifetime.created;
            row.destroyed = lifetime.closed;
            row.beginTick = facts[lifetime.rows.front()].generated;
            row.endTick = lifetime.closed ? facts[lifetime.rows.back()].generated : UINT64_MAX;
        }
        const ConsoleBinding* binding = nullptr;
        size_t matching = 0;
        for (const auto& candidate : bindings) {
            if (candidate.lifetime == number + 1 && candidate.window == facts[lifetime.rows.front()].window) {
                binding = &candidate;
                ++matching;
            }
        }
        const bool classic = binding || std::any_of(lifetime.rows.begin(), lifetime.rows.end(),
            [&](size_t index) { return facts[index].kind == WindowKind::console; });
        if (classic) {
            bool conflict = lifetime.conflict || !clocks || !captureHealthy || !lifetime.created ||
                matching != 1 || !binding || !bindingReady(*binding);
            unsigned int projection = 0;
            bool visibilityComplete = true;
            for (const auto index : lifetime.rows) {
                const auto& fact = facts[index];
                auto& row = result[index];
                row.kind = WindowKind::console;
                row.owner = fact.owner;
                row.thread = fact.thread;
                if (binding) {
                    row.presenter = binding->presenter;
                    row.presenterThread = binding->presenterThread;
                    row.client = binding->client;
                }
                if (!conflict) {
                    const bool source = fact.sourceThread == binding->presenterThread &&
                        ((fact.sourceOwner == binding->presenter && fact.sourceThreadKnown &&
                          fact.sourceThreadCreation == binding->sourceThreadCreation) ||
                         (!fact.sourceOwner && fact.sourceRetained && fact.sourceActor == binding->presenterActor));
                    const auto pair = [&](DWORD pid, DWORD tid, size_t actor) {
                        return (!fact.owner || fact.owner == pid) && (!fact.thread || fact.thread == tid) &&
                            (!fact.identityKnown || fact.reportedActor == actor);
                    };
                    const bool rawHost = pair(binding->presenter, binding->presenterThread, binding->presenterActor);
                    const bool rawClient = pair(binding->client, binding->clientThread, binding->clientActor);
                    const bool observerInterval = binding->control && binding->observerKnown && binding->observerAttached &&
                        binding->clientEnded && binding->departed && binding->observerOnly &&
                        fact.generated >= binding->clientEndTick && fact.received.qpc >= binding->departureQpc;
                    const bool rawObserver = observerInterval &&
                        pair(binding->observer, binding->observerThread, binding->observerActor);
                    const bool zeroClients = observerInterval && binding->observerDetached && binding->observerEnded &&
                        fact.generated >= binding->observerEndTick && fact.received.qpc >= binding->detachQpc;
                    bool owner = rawHost || rawClient || rawObserver;
                    if (fact.identityKnown) {
                        if (rawClient) { owner = projection <= 1; projection = 1; }
                        else if (rawObserver) { owner = projection <= 2; projection = 2; }
                        else if (rawHost && projection != 0) { owner = zeroClients; projection = 3; }
                    }
                    conflict = !source || !owner ||
                        (fact.kind != WindowKind::console && fact.kind != WindowKind::unknown);
                    row.identityKnown = !conflict;
                    row.consoleBound = !conflict;
                    row.ambientConsole = binding->ambient && !conflict;
                    row.owner = binding->client;
                    row.thread = binding->clientThread;
                    row.derived = !fact.identityKnown || fact.owner != row.owner || fact.thread != row.thread;
                }
                row.visibilityMissing =
                    (fact.event == EVENT_OBJECT_SHOW && (!fact.present || !fact.geometryKnown || !fact.hierarchyKnown)) ||
                    (fact.present && fact.visible && (!fact.geometryKnown || !fact.hierarchyKnown)) ||
                    (fact.event == EVENT_OBJECT_CREATE && (!fact.present || !fact.geometryKnown || !fact.hierarchyKnown));
                visibilityComplete = visibilityComplete && !row.visibilityMissing;
            }
            const bool showed = std::any_of(lifetime.rows.begin(), lifetime.rows.end(), [&](size_t index) {
                const auto& fact = facts[index];
                return fact.event == EVENT_OBJECT_SHOW && fact.present && fact.geometryKnown && fact.hierarchyKnown &&
                    fact.topLevel && fact.onScreen;
            });
            const bool complete = !conflict && visibilityComplete && showed && lifetime.closed && binding && binding->control &&
                binding->clientEnded && binding->departed && binding->observerOnly &&
                binding->observerDetached && binding->observerEnded;
            for (const auto index : lifetime.rows) {
                auto& row = result[index];
                row.conflict = conflict;
                row.identityKnown = row.identityKnown && !conflict;
                row.consoleBound = row.consoleBound && !conflict;
                row.ambientConsole = row.ambientConsole && !conflict;
                row.completeControl = complete;
                row.reason = conflict ? "classic-console-binding-inconclusive"
                    : row.visibilityMissing ? "missing-visibility" : "validated-classic-console-binding";
            }
            continue;
        }
        size_t evidence = SIZE_MAX;
        bool conflict = lifetime.conflict || !clocks || !captureHealthy;
        for (const auto index : lifetime.rows) {
            const auto& fact = facts[index];
            if (!fact.identityKnown || !fact.present) continue;
            if (!fact.sourceThread || (fact.sourceOwner && fact.sourceOwner != fact.owner) ||
                (fact.sourceThread != fact.thread &&
                (!fact.sourceOwner || fact.sourceOwner != fact.owner))) conflict = true;
            if (evidence == SIZE_MAX) evidence = index;
            else {
                const auto& known = facts[evidence];
                conflict = conflict || fact.owner != known.owner || fact.thread != known.thread || fact.kind != known.kind;
            }
        }
        for (const auto index : lifetime.rows) {
            const auto& fact = facts[index];
            auto& row = result[index];
            row.created = lifetime.created;
            row.destroyed = lifetime.closed;
            row.beginTick = facts[lifetime.rows.front()].generated;
            row.endTick = lifetime.closed ? facts[lifetime.rows.back()].generated : UINT64_MAX;
            row.conflict = conflict;
            row.owner = fact.owner;
            row.thread = fact.thread;
            row.kind = fact.kind;
            row.identityKnown = fact.identityKnown && !conflict;
            if (!row.identityKnown && !conflict && lifetime.created && evidence != SIZE_MAX) {
                const auto& known = facts[evidence];
                const bool compatibleSource = fact.sourceThread != 0 &&
                    (!fact.sourceOwner || fact.sourceOwner == known.owner) &&
                    (fact.sourceThread == known.thread || (fact.sourceOwner != 0 && fact.sourceOwner == known.owner));
                const bool compatiblePartial = (!fact.owner || fact.owner == known.owner) &&
                    (!fact.thread || fact.thread == known.thread) &&
                    (fact.kind == WindowKind::unknown || fact.kind == known.kind);
                if (compatibleSource && compatiblePartial) {
                    row.owner = known.owner;
                    row.thread = known.thread;
                    row.kind = known.kind;
                    row.identityKnown = true;
                    row.derived = true;
                    row.evidence = evidence;
                }
            }
            const bool terminal = row.kind == WindowKind::console || row.kind == WindowKind::terminal;
            row.visibilityMissing =
                (fact.event == EVENT_OBJECT_SHOW && (!fact.present || !fact.geometryKnown || !fact.hierarchyKnown)) ||
                (fact.present && fact.visible && (!fact.geometryKnown || !fact.hierarchyKnown)) ||
                (terminal && fact.event == EVENT_OBJECT_CREATE && !fact.metadataKnown);
            row.reason = conflict ? "lifetime-or-capture-conflict"
                : !row.identityKnown ? "missing-identity"
                : row.visibilityMissing ? "missing-visibility"
                : row.derived ? "same-lifetime-identity" : "raw-identity";
        }
    }
    return result;
}

inline bool visibleIn(const WindowFact& fact, uint64_t begin, uint64_t end, uint64_t receiptLimit = 0) {
    return fact.metadataKnown && fact.topLevel && fact.onScreen &&
        fact.generated >= begin && fact.generated < end &&
        (!receiptLimit || fact.received.qpc < receiptLimit) &&
        (fact.event == EVENT_OBJECT_SHOW || (fact.present && fact.visible));
}

inline WindowFact effectiveWindow(const WindowFact& raw, const WindowResolution& identity) {
    auto result = raw;
    result.owner = identity.owner;
    result.thread = identity.thread;
    result.kind = identity.kind;
    result.identityKnown = identity.identityKnown;
    result.metadataKnown = identity.identityKnown && raw.geometryKnown && raw.hierarchyKnown;
    return result;
}

inline bool visibleBoundConsole(const WindowFact& raw, const WindowResolution& identity) {
    return identity.consoleBound && !identity.conflict && visibleIn(effectiveWindow(raw, identity), 0, UINT64_MAX);
}

struct ConsoleFact {
    DWORD event = 0, pid = 0, sourceThread = 0, generated32 = 0;
    LONG child = 0;
    uintptr_t window = 0;
    uint64_t generated = 0;
    Moment received;
    size_t sourceActor = 0;
};

class Observer {
    struct SemanticCaller {
        recap::Handle process;
        DWORD pid = 0;
        uint64_t creation = 0, observerCreation = 0, witnessed = 0;
        std::wstring image, module, browser, mode, architecture, source;
    };
    struct Registration {
        recap::Handle process;
        DWORD pid = 0, tid = 0;
        uint64_t creation = 0, threadCreation = 0, witnessed = 0;
        RegisteredPurpose purpose = RegisteredPurpose::product;
        std::wstring image;
        bool imageExact = false;
        size_t primaryActor = 0;
    };
    struct RootAnchor {
        DWORD pid = 0;
        LONGLONG point = 0;
        bool exactStart = false;
        std::wstring image;
    };
    struct Actor {
        recap::Handle process, thread;
        DWORD pid = 0, tid = 0;
        uint64_t processCreation = 0, threadCreation = 0, capturedQpc = 0, lastLiveQpc = 0;
        bool instanceKnown = false, liveAtCapture = false;
        PresenterRole role = PresenterRole::unknown;
        std::wstring image;
        DWORD imageError = 0;
    };
    struct Client {
        recap::Handle process;
        DWORD pid = 0;
        uint64_t creation = 0;
        size_t primaryActor = 0;
        bool control = false;
    };
    struct ControlAssociation {
        DWORD client = 0;
        WindowFact sample;
        size_t observerActor = 0;
        bool membership = false, departed = false, observerOnly = false, detached = false;
        uint64_t departureQpc = 0, detachQpc = 0;
    };
    struct IdentityCounts {
        size_t sourceThreadOpens = 0, sourceProcessOpens = 0, reportedThreadOpens = 0, reportedProcessOpens = 0;
        size_t processTimes = 0, threadTimes = 0, imageQueries = 0, duplicates = 0, closes = 0, closeFailures = 0;
        size_t temporaryOpened = 0, temporaryClosed = 0;
    } identityCounts_;
    struct ObservedHandle {
        Observer& observer;
        recap::Handle value;
        ObservedHandle(Observer& owner, HANDLE handle) : observer(owner), value(handle) {
            if (value) ++observer.identityCounts_.temporaryOpened;
        }
        ~ObservedHandle() {
            if (!value) return;
            ++observer.identityCounts_.temporaryClosed;
            if (value.close() != ERROR_SUCCESS) {
                ++observer.identityCounts_.closeFailures;
                observer.lost_.store(true);
            }
        }
        HANDLE get() const { return value.get(); }
        explicit operator bool() const { return static_cast<bool>(value); }
    };
    struct ProcessCapture {
        std::mutex mutex_;
        std::vector<ProcessEvent> processes_;
        std::vector<ProcessImage> images_;
        std::vector<ThreadEvent> threads_;
        std::atomic<bool> lost_{ false };
        std::atomic<const char*> failure_{ nullptr };
        TRACEHANDLE consumer_ = INVALID_PROCESSTRACE_HANDLE;
    };
    inline static thread_local Observer* current_ = nullptr;
    std::shared_ptr<ProcessCapture> capture_ = std::make_shared<ProcessCapture>();
    std::wstring name_;
    std::vector<unsigned char> properties_;
    TRACEHANDLE session_ = 0;
    TRACEHANDLE& consumer_ = capture_->consumer_;
    std::thread consumerThread_;
    HWINEVENTHOOK consoleHook_ = nullptr;
    HWINEVENTHOOK windowHook_ = nullptr;
    std::mutex& mutex_ = capture_->mutex_;
    std::vector<ProcessEvent>& processes_ = capture_->processes_;
    std::vector<ProcessImage>& images_ = capture_->images_;
    std::vector<ThreadEvent>& threads_ = capture_->threads_;
    std::vector<ConsoleFact> consoles_;
    std::vector<WindowFact> windows_;
    std::map<DWORD, std::wstring> roots_;
    std::vector<Registration> registrations_;
    std::vector<RootAnchor> rootAnchors_;
    std::wstring watchedRoot_;
    std::atomic<bool>& lost_ = capture_->lost_;
    std::atomic<bool> clockValid_{ true };
    bool stopped_ = false;
    bool windowObservation_ = false;
    ObservationProfile profile_;
    bool fixedFixtureSource_ = false;
    uint64_t frequency_ = 0;
    uint64_t captureBegin_ = 0;
    std::vector<Actor> actors_;
    std::map<DWORD, Client> clients_;
    std::vector<ControlAssociation> controlAssociations_;
    std::wstring classicHostImage_;
    std::ostream* report_ = nullptr;
    bool identitiesClosed_ = false;
    const char* finalStage_ = "final-observer-closure";
    DWORD finalPid_ = 0;
    uintptr_t finalWindow_ = 0;
    bool finalBegun_ = false, finalSectionOpen_ = false;
    size_t finalExpectedRoots_ = 0, finalActualRoots_ = 0;
    std::set<DWORD> finalContextPids_;
    std::vector<SourceResolution> finalSources_;
    SemanticCaller semanticCaller_;
    std::vector<SemanticOperation> semanticOperations_;
    SemanticImageGroups semanticImages_;
    size_t semanticOpens_ = 0, semanticCloses_ = 0;

    size_t semanticCallerIndex(const ProcessGraph& graph) const {
        if (!semanticCaller_.process || !semanticCaller_.creation ||
            semanticCaller_.creation > semanticCaller_.observerCreation) return SIZE_MAX;
        const auto point = semanticOperations_.empty() ? semanticCaller_.witnessed : semanticOperations_.front().begin;
        const auto caller = graph.unique(semanticCaller_.pid, static_cast<LONGLONG>(point));
        const auto self = graph.unique(GetCurrentProcessId(), static_cast<LONGLONG>(point));
        if (caller == SIZE_MAX || self == SIZE_MAX ||
            graph.instances[self].start.parent != semanticCaller_.pid) return SIZE_MAX;
        const auto& value = graph.instances[caller];
        const auto capturedImage = executablePath(value.start.pid, value.start);
        if (graph.unique(semanticCaller_.pid, static_cast<LONGLONG>(semanticCaller_.witnessed)) != caller ||
            (capturedImage.find(L'\\') != std::wstring::npos && !recap::samePath(capturedImage, semanticCaller_.image)))
            return SIZE_MAX;
        const auto args = semanticArguments(value.start.diagnosticCommand);
        const auto scenario = semanticCaller_.mode == L"busy" ? L"busy-port-refusal" : L"certification-functionality";
        if (args.size() != 8 ||
            !recap::samePath(std::filesystem::absolute(args[1]).lexically_normal().wstring(), semanticCaller_.module))
            return SIZE_MAX;
        std::map<std::wstring, std::wstring> options;
        for (size_t index = 2; index < args.size(); index += 2)
            if (!options.emplace(args[index], args[index + 1]).second) return SIZE_MAX;
        if (options.size() != 3 || options[L"--scenario"] != scenario ||
            options[L"--architecture"] != semanticCaller_.architecture || options[L"--source"] != semanticCaller_.source)
            return SIZE_MAX;
        return caller;
    }

    bool creation(HANDLE handle, bool thread, uint64_t& value) {
        FILETIME born{}, exited{}, kernel{}, user{};
        if (thread) ++identityCounts_.threadTimes;
        else ++identityCounts_.processTimes;
        const bool result = thread ? GetThreadTimes(handle, &born, &exited, &kernel, &user) != FALSE
                                   : GetProcessTimes(handle, &born, &exited, &kernel, &user) != FALSE;
        value = result ? (static_cast<uint64_t>(born.dwHighDateTime) << 32) | born.dwLowDateTime : 0;
        return result && value != 0;
    }
    recap::Handle duplicate(HANDLE handle) {
        HANDLE copy = nullptr;
        ++identityCounts_.duplicates;
        check(DuplicateHandle(GetCurrentProcess(), handle, GetCurrentProcess(), &copy, 0, FALSE,
                              DUPLICATE_SAME_ACCESS) != FALSE, "identity handle duplication failed");
        return recap::Handle(copy);
    }
    const Actor* actor(size_t id) const { return id && id <= actors_.size() ? &actors_[id - 1] : nullptr; }
    void classify(Actor& value) {
        if (value.role != PresenterRole::unknown) return;
        ++identityCounts_.imageQueries;
        std::vector<wchar_t> path(32768);
        DWORD length = static_cast<DWORD>(path.size());
        if (!QueryFullProcessImageNameW(value.process.get(), 0, path.data(), &length)) {
            value.imageError = GetLastError();
            return;
        }
        value.image = recap::normalizedPath({ path.data(), length });
        value.imageError = 0;
        value.role = recap::samePath(value.image, classicHostImage_) ? PresenterRole::classic : PresenterRole::other;
    }
    size_t retainActor(HANDLE process, HANDLE thread, bool classifyHost) {
        const DWORD pid = GetProcessId(process), tid = GetThreadId(thread);
        uint64_t processBorn = 0, threadBorn = 0;
        if (!pid || !tid || GetProcessIdOfThread(thread) != pid ||
            !creation(process, false, processBorn) || !creation(thread, true, threadBorn)) return 0;
        const auto sampled = moment().qpc;
        const bool live = WaitForSingleObject(process, 0) == WAIT_TIMEOUT && WaitForSingleObject(thread, 0) == WAIT_TIMEOUT;
        for (size_t index = 0; index < actors_.size(); ++index) {
            auto& value = actors_[index];
            if (value.pid == pid && value.tid == tid && value.processCreation == processBorn &&
                value.threadCreation == threadBorn) {
                if (live) value.lastLiveQpc = sampled;
                if (classifyHost) classify(value);
                return index + 1;
            }
        }
        check(actors_.size() < 512, "retained identity bound exceeded");
        Actor value;
        value.process = duplicate(process);
        value.thread = duplicate(thread);
        value.pid = pid;
        value.tid = tid;
        value.processCreation = processBorn;
        value.threadCreation = threadBorn;
        value.instanceKnown = true;
        value.liveAtCapture = live;
        value.capturedQpc = sampled;
        value.lastLiveQpc = live ? sampled : 0;
        if (classifyHost) classify(value);
        actors_.push_back(std::move(value));
        return actors_.size();
    }
    size_t retainedThread(DWORD tid, DWORD pid = 0) const {
        size_t match = 0;
        for (size_t index = 0; index < actors_.size(); ++index) {
            const auto& value = actors_[index];
            if (value.tid == tid && (!pid || value.pid == pid)) {
                if (match) return 0;
                match = index + 1;
            }
        }
        return match;
    }
    size_t registerProcess(DWORD pid, HANDLE process, HANDLE thread, RegisteredPurpose purpose,
                           const std::wstring& expected) {
        uint64_t born = 0;
        check(GetProcessId(process) == pid && creation(process, false, born), "registration process identity unavailable");
        for (size_t index = 0; index < registrations_.size(); ++index) {
            auto& known = registrations_[index];
            if (known.pid == pid && known.creation == born) {
                check(known.purpose == purpose && recap::samePath(known.image, expected), "registration purpose or image conflict");
                if (thread && !known.tid) {
                    known.tid = GetThreadId(thread);
                    check(known.tid && GetProcessIdOfThread(thread) == pid && creation(thread, true, known.threadCreation),
                          "registered primary thread instance differs");
                    known.primaryActor = retainActor(process, thread, false);
                    check(known.primaryActor != 0, "registered primary thread instance differs");
                }
                return index;
            }
        }
        check(WaitForSingleObject(process, 0) == WAIT_TIMEOUT, "registration requires a retained live process instance");
        check(registrations_.size() < 128, "registered process bound exceeded");
        Registration value;
        value.process = duplicate(process);
        value.pid = pid;
        value.creation = born;
        value.purpose = purpose;
        value.witnessed = moment().qpc;
        ++identityCounts_.imageQueries;
        value.image = imagePath(process);
        value.imageExact = recap::samePath(value.image, expected);
        check(value.imageExact, "registered process image differs from its declared purpose");
        if (thread) {
            value.tid = GetThreadId(thread);
            check(value.tid && GetProcessIdOfThread(thread) == pid && creation(thread, true, value.threadCreation),
                  "registered primary thread instance differs");
            value.primaryActor = retainActor(process, thread, false);
            check(value.primaryActor != 0, "registered primary thread instance differs");
        }
        registrations_.push_back(std::move(value));
        return registrations_.size() - 1;
    }
    size_t observeSource(DWORD tid, WindowFact& raw, bool retain, bool recover) {
        if (!tid) return 0;
        ++identityCounts_.sourceThreadOpens;
        ObservedHandle thread(*this, OpenThread(THREAD_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, tid));
        if (thread) raw.sourceOwner = GetProcessIdOfThread(thread.get());
        if (!thread || !raw.sourceOwner) raw.sourceError = GetLastError();
        if (thread && raw.sourceOwner) {
            raw.sourceThreadKnown = creation(thread.get(), true, raw.sourceThreadCreation);
            if (!raw.sourceThreadKnown) raw.sourceError = GetLastError();
            raw.sourceObservedQpc = moment().qpc;
            raw.sourceLive = WaitForSingleObject(thread.get(), 0) == WAIT_TIMEOUT;
            if ((!retain && !raw.sourceLive) || !raw.sourceThreadKnown) return 0;
            for (size_t index = 0; index < actors_.size(); ++index) {
                auto& value = actors_[index];
                if (value.pid != raw.sourceOwner || value.tid != tid ||
                    value.threadCreation != raw.sourceThreadCreation) continue;
                if (raw.sourceLive) value.lastLiveQpc = raw.sourceObservedQpc;
                classify(value);
                return index + 1;
            }
            ++identityCounts_.sourceProcessOpens;
            ObservedHandle process(*this, OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, raw.sourceOwner));
            if (!process) { raw.sourceError = GetLastError(); return 0; }
            if (!retain && WaitForSingleObject(process.get(), 0) != WAIT_TIMEOUT) return 0;
            return retainActor(process.get(), thread.get(), true);
        }
        if (recover) {
            const auto id = retainedThread(tid);
            const auto* value = actor(id);
            if (value && value->role == PresenterRole::classic && value->instanceKnown &&
                GetThreadId(value->thread.get()) == tid &&
                GetProcessIdOfThread(value->thread.get()) == value->pid) {
                raw.sourceRetained = true;
                return id;
            }
        }
        return 0;
    }
    std::vector<SourceWitness> sourceWitnesses() const {
        std::vector<SourceWitness> result;
        for (const auto& value : actors_) {
            if (!value.instanceKnown || !value.liveAtCapture) continue;
            auto through = value.lastLiveQpc;
            const auto sampled = moment().qpc;
            const auto process = WaitForSingleObject(value.process.get(), 0);
            const auto thread = WaitForSingleObject(value.thread.get(), 0);
            if (process == WAIT_FAILED || thread == WAIT_FAILED) lost_.store(true);
            if (process == WAIT_TIMEOUT && thread == WAIT_TIMEOUT) through = sampled;
            result.push_back({ value.pid, value.tid, value.processCreation, value.threadCreation,
                               value.capturedQpc, through });
        }
        return result;
    }
    void reportCapture(std::ostream& report) const {
        std::lock_guard<std::mutex> lock(mutex_);
        size_t processBegin = 0, processEnd = 0, threadBegin = 0, threadEnd = 0;
        std::set<unsigned int> processVersions, threadVersions;
        for (const auto& value : processes_) {
            processBegin += value.rundown == Rundown::begin;
            processEnd += value.rundown == Rundown::end;
            processVersions.insert(value.version);
        }
        for (const auto& value : threads_) {
            threadBegin += value.kind == LifecycleKind::rundownBegin;
            threadEnd += value.kind == LifecycleKind::rundownEnd;
            threadVersions.insert(value.version);
        }
        const auto failure = capture_->failure_.load();
        report << "DIAG source-capture process_records=" << processes_.size() << " process_rundown_begin=" << processBegin
               << " process_rundown_end=" << processEnd << " thread_records=" << threads_.size()
               << " thread_rundown_begin=" << threadBegin << " thread_rundown_end=" << threadEnd
               << " image_records=" << images_.size() << " retained_actors=" << actors_.size()
               << " process_schema_versions=" << processVersions.size()
               << " process_schema_max=" << (processVersions.empty() ? 0 : *processVersions.rbegin())
               << " thread_schema_versions=" << threadVersions.size()
               << " thread_schema_max=" << (threadVersions.empty() ? 0 : *threadVersions.rbegin())
               << " thread_record_limit=" << ThreadRecordLimit << " thread_identity_limit=" << ThreadIdentityLimit
               << " capture_begin_qpc=" << captureBegin_ << " clock_slop_ms=" << SourceClockSlopMs
               << " failure=" << (failure ? failure : "none") << " healthy=" << healthy() << "\n";
        report.flush();
    }
    std::vector<SourceResolution> sourceSnapshot(const ProcessGraph& graph, std::ostream& report) const {
        std::lock_guard<std::mutex> lock(mutex_);
        const ThreadGraph threads(threads_);
        const auto retained = sourceWitnesses();
        std::vector<SourceResolution> result;
        size_t live = 0, witnessed = 0, recovered = 0, rundown = 0, unresolved = 0;
        for (const auto& raw : windows_) {
            auto source = resolveSource(raw, graph, threads, retained, captureBegin_, frequency_, clockValid(), healthy());
            if (!source.known) ++unresolved;
            else if (source.retained) ++witnessed;
            else if (source.liveQuery) ++live;
            else ++recovered;
            if (source.known && source.rundown) ++rundown;
            result.push_back(source);
        }
        report << "DIAG source-lifetimes thread_instances=" << threads.instances.size()
               << " retained_identity=" << witnessed << " live_query_only=" << live
               << " lifecycle_only=" << recovered << " with_rundown=" << rundown
               << " unresolved_sources=" << unresolved << " raw_facts_preserved=1\n";
        report.flush();
        return result;
    }
    size_t observeReported(const WindowFact& raw) {
        if (!raw.identityKnown || !raw.owner || !raw.thread) return 0;
        const auto* source = actor(raw.sourceActor);
        if (!source || source->role != PresenterRole::classic) return 0;
        if (source->pid == raw.owner && source->tid == raw.thread) return raw.sourceActor;
        ++identityCounts_.reportedThreadOpens;
        ObservedHandle thread(*this, OpenThread(THREAD_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, raw.thread));
        if (!thread) return retainedThread(raw.thread, raw.owner);
        if (GetProcessIdOfThread(thread.get()) != raw.owner) return 0;
        ++identityCounts_.reportedProcessOpens;
        ObservedHandle process(*this, OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, raw.owner));
        return process ? retainActor(process.get(), thread.get(), false) : 0;
    }
    bool etwInstance(const Actor& value, const std::vector<ProcessEvent>& events, bool presenter) const {
        const ProcessGraph graph(events);
        const auto index = graph.unique(value.pid, static_cast<LONGLONG>(value.capturedQpc));
        if (index == SIZE_MAX) return false;
        const auto& start = graph.instances[index].start;
        if (!presenter) return true;
        const auto image = executablePath(value.pid, start);
        return recap::samePath(image, classicHostImage_) ||
            (value.role == PresenterRole::classic && recap::samePath(image, L"conhost.exe"));
    }
    void closeIdentityHandles() {
        if (identitiesClosed_) return;
        identitiesClosed_ = true;
        const auto close = [&](recap::Handle& handle) {
            if (!handle) return;
            ++identityCounts_.closes;
            if (handle.close() != ERROR_SUCCESS) { ++identityCounts_.closeFailures; lost_.store(true); }
        };
        for (auto& value : actors_) { close(value.thread); close(value.process); }
        for (auto& [pid, client] : clients_) { (void)pid; close(client.process); }
        for (auto& value : registrations_) close(value.process);
        if (semanticCaller_.process) {
            ++semanticCloses_;
            if (semanticCaller_.process.close() != ERROR_SUCCESS) {
                ++identityCounts_.closeFailures;
                lost_.store(true);
            }
        }
        if (report_) {
            if (semanticOpens_)
                *report_ << "DIAG semantic-handles opened=" << semanticOpens_ << " closed=" << semanticCloses_
                         << " acceptance_registrations_added=0\n";
            *report_ << "DIAG identity-handles source_thread_opens=" << identityCounts_.sourceThreadOpens
                     << " source_process_opens=" << identityCounts_.sourceProcessOpens
                     << " reported_thread_opens=" << identityCounts_.reportedThreadOpens
                     << " reported_process_opens=" << identityCounts_.reportedProcessOpens
                     << " process_time_queries=" << identityCounts_.processTimes
                     << " thread_time_queries=" << identityCounts_.threadTimes
                     << " image_queries=" << identityCounts_.imageQueries << " duplicated=" << identityCounts_.duplicates
                     << " closed=" << identityCounts_.closes
                     << " temporary_opened=" << identityCounts_.temporaryOpened
                     << " temporary_closed=" << identityCounts_.temporaryClosed
                     << " close_failures=" << identityCounts_.closeFailures << "\n";
            report_->flush();
        }
    }
    void finalBegin() {
        check(report_ != nullptr, "final observer requires its report sink");
        if (finalBegun_) return;
        finalBegun_ = true;
        *report_ << "CHECK ENTER final-observer-closure\n";
        report_->flush();
    }
    void finalSection(const char* name) {
        finalBegin();
        if (finalSectionOpen_) *report_ << "CHECK EXIT " << finalStage_ << "\n";
        finalStage_ = name;
        finalSectionOpen_ = true;
        *report_ << "CHECK ENTER " << finalStage_ << "\n";
        report_->flush();
    }
    void reportFinalContext() {
        std::lock_guard<std::mutex> lock(mutex_);
        const ProcessGraph graph(processes_);
        const ThreadGraph semanticThreads(threads_);
        const auto caller = semanticCallerIndex(graph);
        const auto callerPoint = semanticOperations_.empty() ? semanticCaller_.witnessed : semanticOperations_.front().begin;
        const auto self = graph.unique(GetCurrentProcessId(), static_cast<LONGLONG>(callerPoint));
        const auto system = classicHostImage_.substr(0, classicHostImage_.find_last_of(L'\\'));
        const auto windows = std::filesystem::path(system).parent_path().wstring();
        const auto powershell = system + L"\\WindowsPowerShell\\v1.0\\powershell.exe";
        std::vector<SemanticKnownImage> knownImages{
            { classicHostImage_, "trusted-classic-host" }, { powershell, "system-powershell-image" },
            { system + L"\\cmd.exe", "system-cmd-image" },
            { windows + L"\\explorer.exe", "windows-explorer-image", true },
            { system + L"\\RuntimeBroker.exe", "system-runtimebroker-image", true },
            { system + L"\\dllhost.exe", "system-dllhost-image", true },
            { system + L"\\svchost.exe", "system-service-host-image", true },
            { recap::modulePath(), "observer-proof-image" }
        };
        if (caller != SIZE_MAX) {
            knownImages.push_back({ semanticCaller_.image, "proof-caller-runtime-image" });
            if (!semanticCaller_.browser.empty()) knownImages.push_back({ semanticCaller_.browser, "expected-browser-image", true });
        }
        std::set<size_t> roots;
        for (const auto& root : rootAnchors_) {
            knownImages.push_back({ root.image, "product-gui-image" });
            knownImages.push_back({ root.image.substr(0, root.image.find_last_of(L'\\')) + L"\\runtime\\node.exe", "package-node-image" });
            const auto index = graph.unique(root.pid, root.point);
            if (index != SIZE_MAX) roots.insert(index);
        }
        const auto lineage = graph.descendants(roots);
        const bool lineageKnown = lineage.ambiguous == SIZE_MAX && lineage.missingParent == SIZE_MAX;
        std::vector<SemanticBinding> operations;
        for (const auto& operation : semanticOperations_)
            operations.push_back(bindSemanticOperation(graph, caller, operation, powershell, [&](size_t index) {
                return executablePath(graph.instances[index].start.pid, graph.instances[index].start);
            }));
        const auto parentOf = [&](size_t index) {
            const auto& value = graph.instances[index];
            return value.creationObserved ? graph.unique(value.start.parent, value.start.timestamp) : SIZE_MAX;
        };
        std::set<size_t> urlHelpers;
        if (lineageKnown) for (const auto index : lineage.owned) {
            const auto& value = graph.instances[index];
            if (!recap::samePath(executablePath(value.start.pid, value.start), system + L"\\cmd.exe")) continue;
            const auto args = semanticArguments(value.start.diagnosticCommand);
            if (args.size() == 5 && args[1] == L"/c" && args[2] == L"start" && args[3].empty() &&
                args[4] == L"http://127.0.0.1:8787/") urlHelpers.insert(index);
        }
        std::vector<size_t> context;
        std::set<size_t> present, sourceContexts;
        const auto add = [&](size_t index) {
            if (index < graph.instances.size() && present.insert(index).second) context.push_back(index);
        };
        for (size_t index = 0; index < graph.instances.size(); ++index) {
            const auto& value = graph.instances[index];
            if (finalPid_ && value.start.pid != finalPid_ && value.start.parent != finalPid_) continue;
            if (!finalPid_ && !finalContextPids_.empty() && !finalContextPids_.count(value.start.pid)) continue;
            add(index);
            sourceContexts.insert(index);
        }
        add(caller);
        if (caller != SIZE_MAX) add(self);
        for (size_t index = 0; index < operations.size(); ++index)
            if (semanticOperations_[index].name == "aumid-activate") add(operations[index].process);
        for (const auto index : urlHelpers) add(index);
        const auto directCount = context.size();
        for (size_t position = 0; position < directCount; ++position) add(parentOf(context[position]));
        std::set<size_t> shown;
        for (size_t index = 0; index < std::min<size_t>(20, context.size()); ++index) shown.insert(context[index]);
        const auto key = [&](size_t index) {
            return index == SIZE_MAX ? -1LL : static_cast<long long>(graph.instances[index].startRow);
        };
        const bool callerContext = caller != SIZE_MAX && self != SIZE_MAX && shown.count(caller) && shown.count(self);
        size_t boundOperations = 0;
        for (const auto& operation : operations) if (operation.process != SIZE_MAX) ++boundOperations;
        *report_ << "DIAG semantic-summary caller_pid=" << semanticCaller_.pid << " caller_bound=" << callerContext
                 << " caller_instance=" << key(caller) << " caller_creation=" << semanticCaller_.creation
                 << " observer_instance=" << key(self)
                 << " observer_creation=" << semanticCaller_.observerCreation << " caller_witness_qpc=" << semanticCaller_.witnessed
                 << " operation_records=" << operations.size() << " bound_operations=" << boundOperations
                 << " unresolved_operations=" << operations.size() - boundOperations
                 << " query_hiding_explicit=0 expected_browser_only=1 browser_role_meaning=owned-cmd-url-helper acceptance_inputs=0\n";
        size_t emitted = 0;
        for (const auto index : context) {
            if (!shown.count(index)) continue;
            const auto& value = graph.instances[index];
            ++emitted;
            const auto path = executablePath(value.start.pid, value.start);
            const auto semanticImage = semanticImages_.classify(index == caller ? semanticCaller_.image : path, knownImages);
            const Registration* registered = nullptr;
            for (const auto& item : registrations_) {
                if (graph.exact(value.start.pid, value.start.timestamp) != SIZE_MAX && item.pid == value.start.pid &&
                    graph.unique(item.pid, static_cast<LONGLONG>(item.witnessed)) ==
                        graph.exact(value.start.pid, value.start.timestamp)) registered = &item;
            }
            const bool imageKnown = path.find(L'\\') != std::wstring::npos;
            const char* imageRole = imageKnown ? "other-captured-image" : "unknown";
            bool imageMatch = false;
            if (recap::samePath(path, classicHostImage_)) { imageRole = "trusted-classic-host"; imageMatch = true; }
            if (recap::samePath(path, system + L"\\WindowsPowerShell\\v1.0\\powershell.exe")) {
                imageRole = "system-powershell-image"; imageMatch = true;
            }
            if (recap::samePath(path, system + L"\\cmd.exe")) { imageRole = "system-cmd-image"; imageMatch = true; }
            for (const auto& root : rootAnchors_) {
                const auto runtime = root.image.substr(0, root.image.find_last_of(L'\\')) + L"\\runtime\\node.exe";
                if (recap::samePath(path, runtime)) { imageRole = "package-node-image"; imageMatch = true; }
            }
            if (registered && recap::samePath(path, registered->image)) {
                imageRole = purposeName(registered->purpose); imageMatch = true;
            }
            const auto parent = parentOf(index);
            const bool parentReported = parent != SIZE_MAX && shown.count(parent);
            size_t operationOrdinal = 0, operationMatches = 0;
            const char* operationName = "none";
            bool directOperation = false, directOperationChild = false, directExplorerRequest = false;
            for (size_t operation = 0; operation < operations.size(); ++operation) {
                const auto helper = operations[operation].process;
                if (helper == SIZE_MAX || !callerContext) continue;
                const bool direct = helper == index;
                const bool child = parentReported && helper == parent;
                bool explorer = false;
                if (child && semanticOperations_[operation].name == "aumid-activate" &&
                    recap::samePath(path, windows + L"\\explorer.exe")) {
                    const auto args = semanticArguments(value.start.diagnosticCommand);
                    explorer = args.size() == 2 && args[1] == std::wstring(L"shell:AppsFolder\\") + SemanticAumid;
                }
                if (!direct && !child) continue;
                ++operationMatches;
                operationOrdinal = semanticOperations_[operation].ordinal;
                operationName = semanticOperations_[operation].name.c_str();
                directOperation = direct;
                directOperationChild = child;
                directExplorerRequest = explorer;
            }
            if (operationMatches != 1) {
                operationOrdinal = 0; operationName = "none"; directOperation = directOperationChild = directExplorerRequest = false;
            }
            size_t sourceThreads = 0;
            for (const auto& source : finalSources_)
                if (semanticSourceMatches(graph, semanticThreads, index, source)) ++sourceThreads;
            const bool directUrlChild = parentReported && urlHelpers.count(parent);
            const auto association = semanticAssociation(directOperation, directExplorerRequest, directOperationChild,
                urlHelpers.count(index) != 0, directUrlChild, semanticImage.broker);
            *report_ << "DIAG final-process instance_row=" << value.startRow << " pid=" << value.start.pid
                     << " parent=" << value.start.parent << " coverage_begin_qpc=" << value.start.timestamp
                     << " creation_observed=" << value.creationObserved << " rundown_begin=" << value.rundownBegin
                     << " rundown_end=" << value.rundownEnd
                     << " end_qpc=" << (value.ended ? value.until : 0) << " ended=" << value.ended
                     << " exit_known=" << value.end.exitKnown << " exit_code=" << value.end.exitCode
                     << " ambiguous=" << value.ambiguous
                     << " parent_candidates=" << (value.creationObserved ? graph.at(value.start.parent, value.start.timestamp).size() : 0)
                     << " registered=" << (registered != nullptr)
                     << " role=" << (registered ? purposeName(registered->purpose) : "unclassified-captured-process")
                     << " image_known=" << imageKnown << " image_role=" << imageRole << " image_match=" << imageMatch
                     << " registration_qpc=" << (registered ? registered->witnessed : 0)
                     << " process_creation=" << (registered ? registered->creation : 0)
                     << " primary_tid=" << (registered ? registered->tid : 0)
                     << " primary_thread_creation=" << (registered ? registered->threadCreation : 0)
                     << " semantic_context=" << (sourceContexts.count(index) ? "source" : "parent-or-request")
                     << " semantic_image=" << semanticImage.label << " opaque_image_group=" << semanticImage.opaque
                     << " semantic_image_exact=" << semanticImage.exact << " shared_broker_image=" << semanticImage.broker
                     << " parent_instance=" << key(parent) << " parent_context_known=" << parentReported
                     << " operation=" << operationName << " operation_ordinal=" << operationOrdinal
                     << " direct_operation=" << directOperation << " fixed_operation_script=" << directOperation
                     << " direct_operation_child=" << directOperationChild
                     << " aumid_script_match=" << (directOperation && std::string(operationName) == "aumid-activate")
                     << " aumid_request_match=" << directExplorerRequest
                     << " canonical_url_helper=" << (urlHelpers.count(index) != 0) << " direct_url_child=" << directUrlChild
                     << " source_thread_rows_matched=" << sourceThreads << " delegated_association_known=0"
                     << " semantic_association=" << association << " semantic_acceptance_input=0\n";
        }
        *report_ << "DIAG final-context stage=" << finalStage_ << " pid=" << finalPid_ << " hwnd=" << finalWindow_
                 << " expected_roots=" << finalExpectedRoots_ << " actual_roots=" << finalActualRoots_
                 << " process_candidates=" << context.size() << " emitted=" << emitted << " omitted=" << context.size() - emitted
                 << " healthy=" << healthy() << " clocks=" << clockValid() << "\n";
        report_->flush();
    }
    void finalRequire(bool condition, const char* code, DWORD pid = 0, uintptr_t window = 0) {
        if (condition) return;
        finalPid_ = pid;
        finalWindow_ = window;
        *report_ << "CHECK FAIL " << finalStage_ << " condition=" << code << "\n";
        reportFinalContext();
        *report_ << "CHECK FAIL final-observer-closure condition=" << code << "\n";
        report_->flush();
        throw FinalObservationFailure(code, finalStage_);
    }
    HelperScopeEvidence helperScope(const WindowFact& raw, const SourceResolution& source, const ProcessGraph& graph,
                                    const std::set<size_t>& owned) const {
        HelperScopeEvidence evidence;
        const Registration* helper = nullptr;
        for (const auto& item : registrations_) {
            if (!source.known || item.purpose == RegisteredPurpose::product || item.pid != source.owner || !item.tid ||
                item.tid != raw.sourceThread || item.threadCreation != source.threadCreation) continue;
            if (helper) return evidence;
            helper = &item;
        }
        if (!helper) return evidence;
        evidence.registered = true;
        evidence.image = helper->imageExact;
        evidence.thread = source.known;
        evidence.ownerCompatible = !raw.owner || (raw.owner == helper->pid && (!raw.thread || raw.thread == helper->tid));
        const auto instance = graph.unique(helper->pid, static_cast<LONGLONG>(helper->witnessed));
        evidence.instance = helper->purpose == RegisteredPurpose::observer
            ? helper->pid == GetCurrentProcessId() && GetProcessId(helper->process.get()) == helper->pid
            : instance != SIZE_MAX && graph.instances[instance].start.parent == GetCurrentProcessId();
        for (const auto& fact : windows_) {
            if (fact.window != raw.window) continue;
            if (fact.kind == WindowKind::startup) evidence.productAssociation = true;
            if (fact.kind == WindowKind::console || fact.kind == WindowKind::terminal) evidence.terminalAssociation = true;
            const auto owner = graph.unique(fact.owner, static_cast<LONGLONG>(fact.received.qpc));
            if (owner != SIZE_MAX && owned.count(owner)) evidence.productAssociation = true;
        }
        for (const auto& event : consoles_) if (event.window && event.window == raw.window)
            evidence.terminalAssociation = true;
        return evidence;
    }
    struct EnvironmentEvidence {
        bool allowed = false, parentKnown = false;
        size_t instance = SIZE_MAX;
    };
    EnvironmentEvidence fixtureEnvironment(const ProcessGraph& graph, size_t instance) const {
        EnvironmentEvidence result;
        result.instance = instance;
        if (instance == SIZE_MAX || instance >= graph.instances.size()) return result;
        const auto& value = graph.instances[instance];
        const auto path = executablePath(value.start.pid, value.start);
        bool outside = path.size() > 3 && path[1] == L':' && path[2] == L'\\';
        std::set<size_t> roots;
        for (const auto& root : rootAnchors_) {
            const auto runtime = root.image.substr(0, root.image.find_last_of(L'\\')) + L"\\runtime\\node.exe";
            outside = outside && !recap::samePath(path, root.image) && !recap::samePath(path, runtime);
            const auto index = graph.unique(root.pid, root.point);
            if (index == SIZE_MAX) return result;
            roots.insert(index);
        }
        for (const auto& registered : registrations_) outside = outside && !recap::samePath(path, registered.image);
        const auto lineage = graph.descendants(roots);
        if (lineage.ambiguous != SIZE_MAX || lineage.missingParent != SIZE_MAX) return result;
        const bool controlled = lineage.owned.count(instance) || clients_.count(value.start.pid);
        const auto parents = graph.at(value.start.parent, value.start.timestamp);
        result.parentKnown = value.creationObserved && parents.size() == 1 && !graph.instances[parents[0]].ambiguous;
        result.allowed = nativeEnvironmentAllowed(profile_, fixedFixtureSource_, !value.ambiguous, outside, controlled, false);
        return result;
    }
    const Registration* transientSource(const WindowLifetime& life, const ProcessGraph& graph,
                                        const std::vector<SourceResolution>& sources) const {
        if (life.rows.empty()) return nullptr;
        const auto& first = windows_[life.rows.front()];
        const auto& firstSource = sources[life.rows.front()];
        for (const auto& registered : registrations_) {
            if (!firstSource.known || registered.pid != firstSource.owner || !registered.tid ||
                registered.tid != first.sourceThread) continue;
            HelperScopeEvidence evidence;
            evidence.registered = true;
            evidence.image = registered.imageExact;
            evidence.instance = registered.purpose == RegisteredPurpose::observer
                ? registered.pid == GetCurrentProcessId()
                : graph.unique(registered.pid, static_cast<LONGLONG>(registered.witnessed)) != SIZE_MAX;
            evidence.thread = evidence.ownerCompatible = true;
            for (const auto index : life.rows) {
                const auto& raw = windows_[index];
                const auto& recovered = sources[index];
                evidence.thread = evidence.thread && recovered.known && recovered.owner == registered.pid &&
                    recovered.process == firstSource.process && raw.sourceThread == registered.tid &&
                    recovered.threadCreation == registered.threadCreation;
                evidence.ownerCompatible = evidence.ownerCompatible && (!raw.owner || raw.owner == registered.pid) &&
                    (!raw.thread || raw.thread == registered.tid);
                const auto* source = actor(raw.sourceActor);
                if (source && source->role == PresenterRole::classic) evidence.terminalAssociation = true;
            }
            for (size_t index = 0; index < windows_.size(); ++index) {
                if (windows_[index].window == first.window &&
                    std::find(life.rows.begin(), life.rows.end(), index) == life.rows.end()) evidence.productAssociation = true;
            }
            for (const auto& event : consoles_) if (event.window && event.window == first.window)
                evidence.terminalAssociation = true;
            if (completeNonPresenterTransient(windows_, life, evidence)) return &registered;
        }
        return nullptr;
    }
    EnvironmentEvidence environmentWindow(const WindowLifetime& life, const ProcessGraph& graph,
                                           const std::vector<SourceResolution>& sources) const {
        EnvironmentEvidence result;
        if (life.rows.empty()) return result;
        const auto& first = windows_[life.rows.front()];
        const auto& firstSource = sources[life.rows.front()];
        if (!firstSource.known) return result;
        const auto index = firstSource.process;
        result = fixtureEnvironment(graph, index);
        if (!result.allowed) return result;
        for (const auto row : life.rows) {
            const auto& raw = windows_[row];
            const auto& recovered = sources[row];
            const auto* source = actor(raw.sourceActor);
            if (!recovered.known || recovered.owner != firstSource.owner ||
                (raw.owner && raw.owner != firstSource.owner) || raw.kind == WindowKind::startup ||
                raw.kind == WindowKind::console || raw.kind == WindowKind::terminal ||
                (source && source->role == PresenterRole::classic) ||
                recovered.process != index) result.allowed = false;
        }
        for (const auto& event : consoles_) if (event.window && event.window == first.window) result.allowed = false;
        return result;
    }

    EVENT_TRACE_PROPERTIES* properties() {
        return reinterpret_cast<EVENT_TRACE_PROPERTIES*>(properties_.data());
    }
    static std::vector<unsigned char> property(EVENT_RECORD* event, const wchar_t* name) {
        PROPERTY_DATA_DESCRIPTOR descriptor{};
        descriptor.PropertyName = reinterpret_cast<ULONGLONG>(name);
        descriptor.ArrayIndex = ULONG_MAX;
        ULONG size = 0;
        if (TdhGetPropertySize(event, 0, nullptr, 1, &descriptor, &size) != ERROR_SUCCESS) return {};
        check(size <= 65536, "ETW property exceeded bound");
        std::vector<unsigned char> result(size);
        if (size && TdhGetProperty(event, 0, nullptr, 1, &descriptor, size, result.data()) != ERROR_SUCCESS)
            throw std::runtime_error("ETW property could not be decoded");
        return result;
    }
    static DWORD number(const std::vector<unsigned char>& bytes) {
        DWORD result = 0;
        if (bytes.size() == sizeof(result)) memcpy(&result, bytes.data(), sizeof(result));
        return result;
    }
    static std::wstring wide(const std::vector<unsigned char>& bytes) {
        if (bytes.empty() || bytes.size() % sizeof(wchar_t)) return {};
        std::wstring result(bytes.size() / sizeof(wchar_t), L'\0');
        memcpy(result.data(), bytes.data(), bytes.size());
        while (!result.empty() && result.back() == L'\0') result.pop_back();
        return result;
    }
    static std::wstring narrow(const std::vector<unsigned char>& bytes) {
        if (bytes.empty()) return {};
        const int size = MultiByteToWideChar(CP_ACP, 0, reinterpret_cast<const char*>(bytes.data()),
                                            static_cast<int>(bytes.size()), nullptr, 0);
        if (!size) return {};
        std::wstring result(static_cast<size_t>(size), L'\0');
        MultiByteToWideChar(CP_ACP, 0, reinterpret_cast<const char*>(bytes.data()),
                            static_cast<int>(bytes.size()), result.data(), size);
        while (!result.empty() && !result.back()) result.pop_back();
        return result;
    }
    static void WINAPI record(EVENT_RECORD* event) {
        auto* self = static_cast<ProcessCapture*>(event->UserContext);
        if (!self) return;
        const char* failure = "event-field-decode";
        try {
            static constexpr GUID processClass{ 0x3d6fa8d0, 0xfe05, 0x11d0, { 0x9d, 0xda, 0x00, 0xc0, 0x4f, 0xd7, 0xba, 0x7c } };
            static constexpr GUID threadClass{ 0x3d6fa8d1, 0xfe05, 0x11d0, { 0x9d, 0xda, 0x00, 0xc0, 0x4f, 0xd7, 0xba, 0x7c } };
            const auto opcode = event->EventHeader.EventDescriptor.Opcode;
            const auto version = event->EventHeader.EventDescriptor.Version;
            const bool process = IsEqualGUID(event->EventHeader.ProviderId, processClass) != FALSE;
            const bool thread = IsEqualGUID(event->EventHeader.ProviderId, threadClass) != FALSE;
            const bool lifecycle = opcode == EVENT_TRACE_TYPE_START || opcode == EVENT_TRACE_TYPE_END ||
                opcode == EVENT_TRACE_TYPE_DC_START || opcode == EVENT_TRACE_TYPE_DC_END;
            if ((process || thread) && !lifecycle) return;
            const auto rundown = opcode == EVENT_TRACE_TYPE_DC_START ? Rundown::begin
                : opcode == EVENT_TRACE_TYPE_DC_END ? Rundown::end : Rundown::none;
            const auto kind = rundown == Rundown::begin ? LifecycleKind::rundownBegin
                : rundown == Rundown::end ? LifecycleKind::rundownEnd
                : opcode == EVENT_TRACE_TYPE_START ? LifecycleKind::start : LifecycleKind::end;
            const auto pidBytes = property(event, L"ProcessId");
            if (!process && !thread && pidBytes.size() != sizeof(DWORD)) return;
            failure = thread ? "thread-event-field-decode" : "process-event-field-decode";
            check(pidBytes.size() == sizeof(DWORD), "required ETW process identifier could not be decoded");
            const DWORD pid = number(pidBytes);
            std::lock_guard<std::mutex> lock(self->mutex_);
            if (thread) {
                // TDH selects the payload schema using this event's class and version, not header PID/TID.
                const auto tid = property(event, L"TThreadId");
                check(tid.size() == sizeof(DWORD), "required ETW thread identifier could not be decoded");
                failure = "thread-record-bound";
                appendThreadEvent(self->threads_, { pid, number(tid), event->EventHeader.TimeStamp.QuadPart, kind, version });
            } else if (process) {
                const auto parent = property(event, L"ParentId");
                check(parent.size() == sizeof(DWORD), "required ETW parent identifier could not be decoded");
                failure = "process-record-bound";
                check(self->processes_.size() < 8192, "ETW process bound exceeded");
                failure = "process-event-field-decode";
                const auto exit = opcode == EVENT_TRACE_TYPE_END ? property(event, L"ExitStatus") : std::vector<unsigned char>{};
                const auto command = wide(property(event, L"CommandLine"));
                self->processes_.push_back({
                    pid, number(parent), opcode == EVENT_TRACE_TYPE_START,
                    event->EventHeader.TimeStamp.QuadPart,
                    narrow(property(event, L"ImageFileName")),
                    rundown == Rundown::none ? command : std::wstring{},
                    exit.size() == sizeof(DWORD), number(exit), rundown, version, command
                });
            } else {
                failure = "image-event-field-decode";
                const auto image = wide(property(event, L"FileName"));
                if (image.size() >= 4 && recap::samePath(image.substr(image.size() - 4), L".exe")) {
                    failure = "image-record-bound";
                    check(self->images_.size() < 4096, "ETW image bound exceeded");
                    self->images_.push_back({ pid, event->EventHeader.TimeStamp.QuadPart, image, rundown });
                }
            }
        } catch (const std::exception&) {
            const char* previous = nullptr;
            self->failure_.compare_exchange_strong(previous, failure);
            self->lost_.store(true);
        }
    }
    uint64_t eventTick(DWORD generated, const Moment& received) {
        const DWORD delay = static_cast<DWORD>(received.tick) - generated;
        if (delay > 120000 || delay > received.tick) {
            lost_.store(true);
            clockValid_.store(false);
        }
        return received.tick - std::min<uint64_t>(delay, received.tick);
    }
    static void CALLBACK consoleEvent(HWINEVENTHOOK, DWORD event, HWND window, LONG object,
                                      LONG child, DWORD thread, DWORD generated) {
        if (!current_) return;
        if (current_->consoles_.size() >= 8192) { current_->lost_.store(true); return; }
        try {
            const auto received = moment();
            WindowFact source;
            const auto sourceActor = current_->observeSource(thread, source, true, event == EVENT_CONSOLE_END_APPLICATION);
            current_->consoles_.push_back({
                event, static_cast<DWORD>(object), thread, generated, child,
                reinterpret_cast<uintptr_t>(window), current_->eventTick(generated, received), received, sourceActor
            });
        } catch (const std::exception&) { current_->lost_.store(true); }
    }
    static void CALLBACK windowEvent(HWINEVENTHOOK, DWORD event, HWND window, LONG object,
                                     LONG child, DWORD thread, DWORD generated) {
        if (!current_ || object != OBJID_WINDOW || child != CHILDID_SELF || !window) return;
        try {
            auto fact = windowFact(window);
            fact.event = event;
            fact.object = object;
            fact.child = child;
            fact.callbackThread = GetCurrentThreadId();
            fact.sourceThread = thread;
            const auto* knownSource = current_->actor(current_->retainedThread(thread));
            const bool retain = fact.kind == WindowKind::console ||
                (knownSource && knownSource->role == PresenterRole::classic);
            fact.sourceActor = current_->observeSource(thread, fact, retain,
                event == EVENT_OBJECT_DESTROY || event == EVENT_OBJECT_HIDE);
            if (fact.kind == WindowKind::console) fact.reportedActor = current_->observeReported(fact);
            fact.generated32 = generated;
            fact.received = moment();
            fact.generated = current_->eventTick(generated, fact.received);
            if (!current_->watchedRoot_.empty() && fact.kind == WindowKind::startup && fact.owner &&
                (event == EVENT_OBJECT_CREATE || event == EVENT_OBJECT_SHOW)) {
                ++current_->identityCounts_.sourceProcessOpens;
                ObservedHandle process(*current_, OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, fact.owner));
                if (process && WaitForSingleObject(process.get(), 0) == WAIT_TIMEOUT &&
                    recap::samePath(imagePath(process.get()), current_->watchedRoot_)) {
                    ++current_->identityCounts_.reportedThreadOpens;
                    ObservedHandle primary(*current_, OpenThread(THREAD_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, fact.thread));
                    if (primary && GetProcessIdOfThread(primary.get()) == fact.owner)
                        current_->bindRoot(fact.owner, process.get(), primary.get());
                }
            }
            check(current_->windows_.size() < 8192, "window observation bound exceeded");
            current_->windows_.push_back(fact);
        } catch (const std::exception&) { current_->lost_.store(true); }
    }
public:
    explicit Observer(bool observeWindows, ObservationProfile profile, bool fixedFixtureSource = false)
        : windowObservation_(observeWindows), profile_(profile), fixedFixtureSource_(fixedFixtureSource) {
        check(profile != ObservationProfile::nativeFixture || fixedFixtureSource,
              "native observation profile requires the fixed fixture contract");
        check(current_ == nullptr, "observer already active");
        wchar_t system[32768]{};
        const auto systemLength = GetSystemDirectoryW(system, static_cast<UINT>(std::size(system)));
        check(systemLength && systemLength < std::size(system), "trusted console host path unavailable");
        classicHostImage_ = recap::normalizedPath(std::wstring(system) + L"\\conhost.exe");
        registerProcess(GetCurrentProcessId(), GetCurrentProcess(), GetCurrentThread(),
                        RegisteredPurpose::observer, recap::modulePath());
        consoles_.reserve(8192);
        if (windowObservation_) windows_.reserve(8192);
        LARGE_INTEGER frequency{};
        check(QueryPerformanceFrequency(&frequency) != FALSE && frequency.QuadPart > 0, "clock frequency unavailable");
        frequency_ = static_cast<uint64_t>(frequency.QuadPart);
        name_ = L"RecapPageStartupProof-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64());
        properties_.resize(sizeof(EVENT_TRACE_PROPERTIES) + (name_.size() + 1) * sizeof(wchar_t));
        auto* settings = properties();
        settings->Wnode.BufferSize = static_cast<ULONG>(properties_.size());
        settings->Wnode.Flags = WNODE_FLAG_TRACED_GUID;
        settings->Wnode.ClientContext = 1;
        check(SUCCEEDED(CoCreateGuid(&settings->Wnode.Guid)), "trace identity could not be created");
        settings->BufferSize = 64;
        settings->MinimumBuffers = 8;
        settings->MaximumBuffers = 64;
        settings->LogFileMode = EVENT_TRACE_REAL_TIME_MODE | EVENT_TRACE_SYSTEM_LOGGER_MODE;
        settings->FlushTimer = 1;
        settings->EnableFlags = EVENT_TRACE_FLAG_PROCESS | EVENT_TRACE_FLAG_THREAD |
            EVENT_TRACE_FLAG_IMAGE_LOAD | EVENT_TRACE_FLAG_NO_SYSCONFIG;
        settings->LoggerNameOffset = sizeof(EVENT_TRACE_PROPERTIES);
        memcpy(properties_.data() + settings->LoggerNameOffset, name_.c_str(), (name_.size() + 1) * sizeof(wchar_t));
        captureBegin_ = moment().qpc;
        check(StartTraceW(&session_, name_.c_str(), settings) == ERROR_SUCCESS, "owned ETW session could not start");
        EVENT_TRACE_LOGFILEW log{};
        log.LoggerName = name_.data();
        log.ProcessTraceMode = PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD;
        if (windowObservation_) log.ProcessTraceMode |= PROCESS_TRACE_MODE_RAW_TIMESTAMP;
        log.EventRecordCallback = record;
        log.Context = capture_.get();
        consumer_ = OpenTraceW(&log);
        if (consumer_ == INVALID_PROCESSTRACE_HANDLE) {
            ControlTraceW(session_, name_.c_str(), properties(), EVENT_TRACE_CONTROL_STOP);
            throw std::runtime_error("ETW consumer could not open");
        }
        current_ = this;
        consoleHook_ = SetWinEventHook(EVENT_CONSOLE_START_APPLICATION, EVENT_CONSOLE_END_APPLICATION,
            nullptr, consoleEvent, 0, 0, WINEVENT_OUTOFCONTEXT);
        if (!consoleHook_) {
            current_ = nullptr;
            CloseTrace(consumer_);
            ControlTraceW(session_, name_.c_str(), properties(), EVENT_TRACE_CONTROL_STOP);
            throw std::runtime_error("console observer could not start");
        }
        if (windowObservation_) {
            windowHook_ = SetWinEventHook(EVENT_OBJECT_CREATE, EVENT_OBJECT_HIDE, nullptr,
                windowEvent, 0, 0, WINEVENT_OUTOFCONTEXT);
            if (!windowHook_) {
                UnhookWinEvent(consoleHook_);
                current_ = nullptr;
                CloseTrace(consumer_);
                ControlTraceW(session_, name_.c_str(), properties(), EVENT_TRACE_CONTROL_STOP);
                throw std::runtime_error("window lifecycle observer could not start");
            }
        }
        try {
            consumerThread_ = std::thread([state = capture_] {
                const auto status = ProcessTrace(&state->consumer_, 1, nullptr, nullptr);
                if (status != ERROR_SUCCESS && status != ERROR_CANCELLED) state->lost_.store(true);
            });
        } catch (const std::system_error&) {
            if (windowHook_) UnhookWinEvent(windowHook_);
            UnhookWinEvent(consoleHook_);
            current_ = nullptr;
            CloseTrace(consumer_);
            ControlTraceW(session_, name_.c_str(), properties(), EVENT_TRACE_CONTROL_STOP);
            throw;
        }
    }
    ~Observer() {
        if (!stopped_) stop();
        closeIdentityHandles();
    }
    void stop() {
        if (stopped_) return;
        const auto status = ControlTraceW(session_, name_.c_str(), properties(), EVENT_TRACE_CONTROL_STOP);
        if (status != ERROR_SUCCESS) lost_.store(true);
        if (properties()->EventsLost || properties()->LogBuffersLost || properties()->RealTimeBuffersLost) lost_.store(true);
        if (status != ERROR_SUCCESS) CloseTrace(consumer_);
        if (consumerThread_.joinable()) {
            const auto deadline = GetTickCount64() + 2000;
            auto wait = WaitForSingleObject(consumerThread_.native_handle(), 1000);
            if (wait != WAIT_OBJECT_0) {
                CloseTrace(consumer_);
                const auto now = GetTickCount64();
                wait = WaitForSingleObject(consumerThread_.native_handle(),
                    now < deadline ? static_cast<DWORD>(deadline - now) : 0);
            }
            if (wait == WAIT_OBJECT_0) consumerThread_.join();
            else {
                lost_.store(true);
                consumerThread_.detach();
            }
        }
        if (status == ERROR_SUCCESS) CloseTrace(consumer_);
        pump(0);
        if (consoleHook_ && !UnhookWinEvent(consoleHook_)) lost_.store(true);
        if (windowHook_ && !UnhookWinEvent(windowHook_)) lost_.store(true);
        current_ = nullptr;
        stopped_ = true;
    }
    void reportTo(std::ostream& report) { report_ = &report; }
    void bindSemanticCaller(DWORD pid, const std::wstring& image, const std::wstring& module,
                            const std::wstring& browser, const std::wstring& mode,
                            const std::wstring& architecture, const std::wstring& source) {
        check(!semanticCaller_.process && pid && pid != GetCurrentProcessId(), "semantic caller input is invalid");
        SemanticCaller value;
        value.process = recap::Handle(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid));
        check(value.process && GetProcessId(value.process.get()) == pid &&
              WaitForSingleObject(value.process.get(), 0) == WAIT_TIMEOUT, "semantic caller instance unavailable");
        FILETIME born{}, exited{}, kernel{}, user{}, selfBorn{};
        check(GetProcessTimes(value.process.get(), &born, &exited, &kernel, &user) != FALSE &&
              GetProcessTimes(GetCurrentProcess(), &selfBorn, &exited, &kernel, &user) != FALSE,
              "semantic caller creation unavailable");
        value.creation = (static_cast<uint64_t>(born.dwHighDateTime) << 32) | born.dwLowDateTime;
        value.observerCreation = (static_cast<uint64_t>(selfBorn.dwHighDateTime) << 32) | selfBorn.dwLowDateTime;
        value.image = imagePath(value.process.get());
        const auto expectedModule = (std::filesystem::current_path() / L"scripts" / L"msix-proof.mjs").wstring();
        check(recap::samePath(value.image, image) && recap::samePath(module, expectedModule),
              "semantic caller image or proof module differs");
        value.pid = pid; value.module = recap::normalizedPath(module); value.browser = recap::normalizedPath(browser);
        value.mode = mode; value.architecture = architecture; value.source = source;
        value.witnessed = moment().qpc;
        semanticCaller_ = std::move(value);
        ++semanticOpens_;
    }
    void beginSemanticOperation(size_t ordinal, const std::string& name, const std::wstring& script) {
        check(semanticCaller_.process && ordinal == semanticOperations_.size() + 1 &&
              ordinal <= SemanticOperationLimit &&
              (semanticOperations_.empty() || semanticOperations_.back().ended), "semantic operation order differs");
        check(name == "aumid-activate" || name == "listener-query" || name == "package-process-query" ||
              name == "package-info-query" || name == "process-exists-query" || name == "browser-snapshot-query",
              "semantic operation name is invalid");
        semanticOperations_.push_back({ ordinal, name, script, moment().qpc });
        if (report_) {
            *report_ << "DIAG semantic-operation phase=begin ordinal=" << ordinal << " operation=" << name
                     << " fixed_script=" << semanticFixedScript(name, script)
                     << " begin_qpc=" << semanticOperations_.back().begin << " acceptance_input=0\n";
            report_->flush();
        }
    }
    void endSemanticOperation(size_t ordinal, bool succeeded) {
        check(!semanticOperations_.empty() && ordinal == semanticOperations_.back().ordinal &&
              !semanticOperations_.back().ended, "semantic operation end differs");
        auto& value = semanticOperations_.back();
        value.end = moment().qpc;
        value.ended = true;
        value.succeeded = succeeded;
        if (report_) {
            *report_ << "DIAG semantic-operation phase=end ordinal=" << ordinal << " operation=" << value.name
                     << " end_qpc=" << value.end << " helper_succeeded=" << succeeded << " acceptance_input=0\n";
            report_->flush();
        }
    }
    void bindClient(DWORD pid, HANDLE process, HANDLE primaryThread = nullptr, DWORD primaryTid = 0, bool control = false) {
        uint64_t born = 0;
        check(pid && GetProcessId(process) == pid && creation(process, false, born), "client process identity unavailable");
        auto found = clients_.find(pid);
        if (found != clients_.end()) {
            check(found->second.creation == born && found->second.control == control, "client process instance changed");
            return;
        }
        check(clients_.size() < 128, "client identity bound exceeded");
        Client client;
        client.pid = pid;
        client.creation = born;
        client.control = control;
        client.process = duplicate(process);
        if (primaryThread) {
            check(primaryTid && GetThreadId(primaryThread) == primaryTid, "returned primary thread identity differed");
            client.primaryActor = retainActor(process, primaryThread, false);
            check(client.primaryActor != 0, "returned primary thread could not be bound");
        }
        check(!control || client.primaryActor != 0, "control primary thread is required");
        clients_.emplace(pid, std::move(client));
    }
    void bindControlSample(DWORD pid, const WindowFact& sample) {
        const auto found = clients_.find(pid);
        check(found != clients_.end() && found->second.control, "control client was not retained");
        const auto* client = actor(found->second.primaryActor);
        check(client && sample.metadataKnown && sample.kind == WindowKind::console &&
              sample.owner == pid && sample.thread == client->tid, "control sample primary thread differed");
        check(reinterpret_cast<uintptr_t>(GetConsoleWindow()) == sample.window, "control sample console association differed");
        std::array<DWORD, 128> members{};
        const auto count = GetConsoleProcessList(members.data(), static_cast<DWORD>(members.size()));
        check(count == 2 && std::find(members.begin(), members.begin() + count, pid) != members.begin() + count &&
              std::find(members.begin(), members.begin() + count, GetCurrentProcessId()) != members.begin() + count,
              "control binding requires exactly its client and observer");
        const auto self = retainActor(GetCurrentProcess(), GetCurrentThread(), false);
        check(self && actor(self)->pid == GetCurrentProcessId() && actor(self)->tid == GetCurrentThreadId(),
              "attached observer thread could not be bound");
        check(controlAssociations_.size() < 8, "control association bound exceeded");
        ControlAssociation association;
        association.client = pid;
        association.sample = sample;
        association.observerActor = self;
        association.membership = true;
        controlAssociations_.push_back(association);
    }
    void confirmControlDeparture(DWORD pid) {
        const auto found = clients_.find(pid);
        check(found != clients_.end() && WaitForSingleObject(found->second.process.get(), 0) == WAIT_OBJECT_0,
              "control departure was not confirmed on its retained instance");
        for (auto& association : controlAssociations_) if (association.client == pid) {
            association.departed = true;
            association.departureQpc = moment().qpc;
        }
    }
    void confirmObserverOnly(DWORD pid) {
        for (auto& association : controlAssociations_) if (association.client == pid) {
            std::array<DWORD, 128> members{};
            const auto count = GetConsoleProcessList(members.data(), static_cast<DWORD>(members.size()));
            check(association.departed && reinterpret_cast<uintptr_t>(GetConsoleWindow()) == association.sample.window &&
                  count == 1 && members[0] == GetCurrentProcessId(),
                  "remaining attached observer association was not confirmed");
            association.observerOnly = true;
        }
    }
    void confirmObserverDetached(DWORD pid) {
        for (auto& association : controlAssociations_) if (association.client == pid) {
            check(association.observerOnly && GetConsoleWindow() == nullptr, "observer detach association was not confirmed");
            association.detached = true;
            association.detachQpc = moment().qpc;
        }
    }
    void finishIdentities() {
        check(stopped_, "identity handles must outlive observation");
        closeIdentityHandles();
        assertHealthy();
    }
    bool console(DWORD pid, DWORD event = EVENT_CONSOLE_START_APPLICATION) const {
        return std::any_of(consoles_.begin(), consoles_.end(),
            [&](const auto& fact) { return fact.pid == pid && fact.event == event; });
    }
    bool observesWindows() const { return windowObservation_; }
    uint64_t frequency() const { return frequency_; }
    bool clockValid() const { return clockValid_.load(); }
    bool healthy() const { return !lost_.load(); }
    ULONG eventsLost() { return properties()->EventsLost; }
    ULONG buffersLost() { return properties()->LogBuffersLost + properties()->RealTimeBuffersLost; }
    const std::vector<WindowFact>& windows() const { return windows_; }
    const std::vector<ConsoleFact>& consoles() const { return consoles_; }
    std::vector<ConsoleBinding> consoleBindings() const {
        std::lock_guard<std::mutex> lock(mutex_);
        const ProcessGraph graph(processes_);
        const auto lifetimes = windowLifetimes(windows_);
        std::vector<ConsoleBinding> result;
        for (size_t number = 0; number < lifetimes.size(); ++number) {
            const auto& life = lifetimes[number];
            const auto& first = windows_[life.rows.front()];
            const auto endTick = life.closed ? windows_[life.rows.back()].generated : UINT64_MAX;
            const ControlAssociation* control = nullptr;
            size_t controlMatches = 0;
            for (const auto& candidate : controlAssociations_) {
                if (candidate.sample.window == first.window && candidate.sample.received.tick >= first.generated &&
                    candidate.sample.received.tick <= endTick) { control = &candidate; ++controlMatches; }
            }
            if (!control && std::none_of(life.rows.begin(), life.rows.end(),
                [&](size_t index) { return windows_[index].kind == WindowKind::console; })) continue;
            ConsoleBinding binding;
            binding.window = first.window;
            binding.lifetime = number + 1;
            binding.control = control != nullptr;
            size_t hostId = 0;
            for (const auto index : life.rows) {
                const auto& raw = windows_[index];
                auto id = raw.sourceActor;
                if (!id && raw.sourceThreadKnown) {
                    id = retainedThread(raw.sourceThread, raw.sourceOwner);
                    const auto* value = actor(id);
                    if (!value || value->threadCreation != raw.sourceThreadCreation) id = 0;
                }
                if (id) { hostId = id; break; }
            }
            const auto* host = actor(hostId);
            if (host) {
                binding.presenterActor = hostId;
                binding.presenter = host->pid;
                binding.presenterThread = host->tid;
                binding.sourceThreadCreation = host->threadCreation;
                binding.role = host->role;
                binding.presenterKnown = host->instanceKnown && host->liveAtCapture;
                binding.sourceThreadBound = host->instanceKnown;
                binding.presenterEtw = etwInstance(*host, processes_, true);
            }
            DWORD clientPid = control ? control->client : 0;
            bool clientConflict = controlMatches > 1;
            if (!control) for (const auto index : life.rows) {
                const auto found = clients_.find(windows_[index].owner);
                if (found == clients_.end() || found->second.control) continue;
                if (clientPid && clientPid != found->first) clientConflict = true;
                clientPid = found->first;
            }
            binding.client = clientPid;
            const auto knownClient = clients_.find(clientPid);
            size_t clientId = knownClient == clients_.end() ? 0 : knownClient->second.primaryActor;
            if (!clientId && knownClient != clients_.end()) {
                for (const auto index : life.rows) {
                    const auto id = windows_[index].reportedActor;
                    const auto* candidate = actor(id);
                    if (!candidate || candidate->pid != clientPid ||
                        candidate->processCreation != knownClient->second.creation) continue;
                    if (clientId && clientId != id) clientConflict = true;
                    clientId = id;
                }
            }
            bool ambientCandidate = false;
            if (!clientPid && knownClient == clients_.end() && profile_ == ObservationProfile::nativeFixture &&
                fixedFixtureSource_) {
                for (const auto index : life.rows) {
                    const auto id = windows_[index].reportedActor;
                    const auto* candidate = actor(id);
                    if (!candidate || !host || candidate->pid == host->pid) continue;
                    const auto node = graph.unique(candidate->pid, static_cast<LONGLONG>(candidate->capturedQpc));
                    if (!fixtureEnvironment(graph, node).allowed) { clientConflict = true; continue; }
                    if (clientId && clientId != id) clientConflict = true;
                    clientId = id;
                    clientPid = candidate->pid;
                    ambientCandidate = true;
                }
                binding.client = clientPid;
            }
            const auto* client = actor(clientId);
            if (client && (knownClient != clients_.end() || ambientCandidate)) {
                binding.clientActor = clientId;
                binding.clientThread = client->tid;
                binding.clientKnown = !clientConflict && client->instanceKnown && client->liveAtCapture &&
                    client->pid == clientPid && (ambientCandidate || client->processCreation == knownClient->second.creation);
                binding.clientThreadBound = client->instanceKnown;
                binding.clientEtw = etwInstance(*client, processes_, false);
                binding.ambient = ambientCandidate;
            }
            const Actor* self = control ? actor(control->observerActor) : nullptr;
            if (control && self) {
                binding.observerActor = control->observerActor;
                binding.observer = self->pid;
                binding.observerThread = self->tid;
                binding.observerKnown = self->instanceKnown && self->liveAtCapture && self->pid == GetCurrentProcessId();
                binding.membership = control->membership;
                binding.sampleMapped = client && control->sample.metadataKnown && control->sample.kind == WindowKind::console &&
                    control->sample.owner == clientPid && control->sample.thread == client->tid;
                binding.sampleTick = control->sample.received.tick;
                binding.observerAttached = control->membership;
                binding.departed = control->departed;
                binding.departureQpc = control->departureQpc;
                binding.observerOnly = control->observerOnly;
                binding.observerDetached = control->detached;
                binding.detachQpc = control->detachQpc;
            }
            size_t starts = 0, ends = 0, observerStarts = 0, observerEnds = 0;
            uint64_t startTick = 0;
            bool associationsValid = host && life.created && !life.conflict;
            for (const auto& event : consoles_) {
                if (event.window != first.window || event.generated < first.generated || event.generated > endTick) continue;
                const auto* source = actor(event.sourceActor);
                const bool sourceKnown = host && source && source->instanceKnown &&
                    source->role == PresenterRole::classic && source->pid == host->pid &&
                    source->processCreation == host->processCreation && event.child == 0;
                if (!sourceKnown) { associationsValid = false; continue; }
                if (ambientCandidate && clients_.count(event.pid)) { associationsValid = false; continue; }
                if (event.pid == clientPid) {
                    if (event.event == EVENT_CONSOLE_START_APPLICATION) { ++starts; startTick = event.generated; }
                    if (event.event == EVENT_CONSOLE_END_APPLICATION) { ++ends; binding.clientEndTick = event.generated; }
                } else if (control && self && event.pid == self->pid) {
                    if (event.event == EVENT_CONSOLE_START_APPLICATION) ++observerStarts;
                    if (event.event == EVENT_CONSOLE_END_APPLICATION) { ++observerEnds; binding.observerEndTick = event.generated; }
                } else {
                    associationsValid = false;
                }
            }
            binding.association = associationsValid && starts == 1;
            binding.noOtherClients = associationsValid && starts <= 1 && ends <= 1 && observerStarts <= 1 && observerEnds <= 1;
            binding.clientEnded = ends == 1 && binding.clientEndTick >= startTick;
            binding.observerEnded = observerStarts == 1 && observerEnds == 1 &&
                binding.observerEndTick >= binding.clientEndTick;
            binding.clientStarts = starts;
            binding.clientEnds = ends;
            binding.observerStarts = observerStarts;
            binding.observerEnds = observerEnds;
            if (control) binding.observerAttached = binding.observerAttached && observerStarts == 1;
            result.push_back(binding);
        }
        return result;
    }
    std::vector<WindowResolution> resolvedWindows() const {
        return correlateWindows(windows_, clockValid(), healthy(), consoleBindings());
    }
    void reportBindings(std::ostream& report) const {
        const auto bindings = consoleBindings();
        for (size_t index = 0; index < std::min<size_t>(20, bindings.size()); ++index) {
            const auto& value = bindings[index];
            const auto* host = actor(value.presenterActor);
            const auto* client = actor(value.clientActor);
            report << "DIAG console-binding lifetime=" << value.lifetime << " hwnd=" << value.window
                   << " ready=" << bindingReady(value) << " host_role=" << presenterRoleName(value.role)
                   << " host=" << value.presenter << " host_thread=" << value.presenterThread
                   << " host_instance=" << value.presenterKnown << " host_thread_bound=" << value.sourceThreadBound
                   << " host_etw=" << value.presenterEtw << " host_image_exact=" << (value.role == PresenterRole::classic)
                   << " host_image_error=" << (host ? host->imageError : 0)
                   << " host_creation=" << (host ? host->processCreation : 0)
                   << " host_thread_creation=" << value.sourceThreadCreation << " client=" << value.client
                   << " client_thread=" << value.clientThread << " client_instance=" << value.clientKnown
                   << " client_thread_bound=" << value.clientThreadBound << " client_etw=" << value.clientEtw
                   << " client_creation=" << (client ? client->processCreation : 0)
                   << " client_thread_creation=" << (client ? client->threadCreation : 0)
                   << " control=" << value.control << " association=" << value.association
                   << " ambient=" << value.ambient << " profile=" << profileName(profile_)
                   << " no_other_clients=" << value.noOtherClients << " membership=" << value.membership
                   << " sample_mapped=" << value.sampleMapped << " observer=" << value.observer
                   << " observer_thread=" << value.observerThread << " observer_bound=" << value.observerKnown
                   << " observer_attached=" << value.observerAttached << " client_end=" << value.clientEnded
                   << " client_starts=" << value.clientStarts << " client_ends=" << value.clientEnds
                   << " observer_starts=" << value.observerStarts << " observer_ends=" << value.observerEnds
                   << " departed=" << value.departed << " departure_qpc=" << value.departureQpc
                   << " observer_only=" << value.observerOnly << " observer_detached=" << value.observerDetached
                   << " observer_end=" << value.observerEnded << " detach_qpc=" << value.detachQpc << "\n";
        }
        report << "DIAG console-binding-summary bindings=" << bindings.size()
               << " omitted=" << (bindings.size() > 20 ? bindings.size() - 20 : 0)
               << " retained_instances=" << actors_.size() << " retained_clients=" << clients_.size() << "\n";
        report.flush();
    }
    bool windowEventSeen(uintptr_t window, DWORD event) const {
        const auto resolution = resolvedWindows();
        for (size_t index = 0; index < windows_.size(); ++index)
            if (windows_[index].window == window && windows_[index].event == event &&
                resolution[index].identityKnown && !resolution[index].conflict) return true;
        return false;
    }
    bool passiveVisible(uintptr_t window, uint64_t begin, uint64_t end, uint64_t receiptLimit = 0) const {
        return std::any_of(windows_.begin(), windows_.end(), [&](const auto& fact) {
            return fact.window == window && visibleIn(fact, begin, end, receiptLimit);
        });
    }
    bool visibleForProcess(DWORD pid) const {
        const auto resolution = resolvedWindows();
        for (size_t index = 0; index < windows_.size(); ++index) {
            const auto& row = resolution[index];
            if (row.client == pid && visibleBoundConsole(windows_[index], row)) return true;
            if (row.kind == WindowKind::terminal && row.identityKnown && !row.conflict &&
                row.owner == pid && visibleIn(windows_[index], 0, UINT64_MAX)) return true;
        }
        return false;
    }
    bool potentialConsole(DWORD pid, const WindowFact& raw, const WindowResolution& identity) const {
        return std::any_of(consoles_.begin(), consoles_.end(), [&](const auto& event) {
            return event.event == EVENT_CONSOLE_START_APPLICATION && event.pid == pid && event.window &&
                event.window == raw.window && event.generated >= identity.beginTick && event.generated <= identity.endTick;
        });
    }
    bool pendingTerminalIdentity(DWORD pid) const {
        const auto resolution = resolvedWindows();
        for (size_t index = 0; index < windows_.size(); ++index) {
            const auto& raw = windows_[index];
            const auto& row = resolution[index];
            if (((raw.kind == WindowKind::console && (raw.owner == pid || row.client == pid)) ||
                 potentialConsole(pid, raw, row)) && !row.consoleBound) return true;
        }
        return false;
    }
    std::vector<ProcessEvent> processes() {
        std::lock_guard<std::mutex> lock(mutex_);
        return processes_;
    }
    void assertHealthy() const { check(!lost_.load(), "observer lost data or could not complete capture"); }
    void watchRootImage(const std::wstring& image) { watchedRoot_ = recap::normalizedPath(image); }
    void bindHelper(DWORD pid, HANDLE process, HANDLE primaryThread) {
        registerProcess(pid, process, primaryThread, RegisteredPurpose::visual, recap::modulePath());
    }
    void bindRoot(DWORD pid, HANDLE process, HANDLE primaryThread = nullptr) {
        const auto image = imagePath(process);
        const auto registered = registerProcess(pid, process, primaryThread, RegisteredPurpose::product, image);
        const auto point = static_cast<LONGLONG>(registrations_[registered].witnessed);
        roots_[pid] = image;
        if (std::none_of(rootAnchors_.begin(), rootAnchors_.end(),
            [&](const auto& value) { return value.pid == pid && value.point == point; }))
            rootAnchors_.push_back({ pid, point, false, image });
        bindClient(pid, process);
    }
    std::pair<size_t, size_t> entryCounts(const std::wstring& expected) {
        std::lock_guard<std::mutex> lock(mutex_);
        const ProcessGraph graph(processes_);
        size_t roots = 0, complete = 0;
        for (const auto& value : graph.instances) {
            if (!recap::samePath(executablePath(value.start.pid, value.start), expected)) continue;
            ++roots;
            if (value.ended && !value.ambiguous) ++complete;
        }
        return { roots, complete };
    }
    std::vector<DWORD> registeredRoots(const std::wstring& expected, size_t count, DWORD exitCode) {
        finalExpectedRoots_ = count;
        finalSection("final-root-registration");
        finalRequire(stopped_, "final-capture-not-stopped");
        finalRequire(healthy(), "final-capture-unhealthy");
        std::vector<DWORD> roots;
        const auto events = processes();
        const ProcessGraph graph(events);
        std::vector<RootAnchor> captured;
        for (const auto& value : graph.instances) {
            if (!recap::samePath(executablePath(value.start.pid, value.start), expected)) continue;
            roots.push_back(value.start.pid);
            finalActualRoots_ = roots.size();
            const auto retained = std::find_if(rootAnchors_.begin(), rootAnchors_.end(), [&](const auto& anchor) {
                return anchor.pid == value.start.pid && !anchor.exactStart &&
                    graph.unique(anchor.pid, anchor.point) == graph.exact(value.start.pid, value.start.timestamp);
            });
            finalRequire(retained != rootAnchors_.end(), "final-root-retained-instance-missing", value.start.pid);
            captured.push_back(*retained);
            finalRequire(!value.ambiguous && value.ended && value.end.exitKnown && value.end.exitCode == exitCode,
                         "final-root-exit-mismatch", value.start.pid);
        }
        finalRequire(roots.size() == count, "final-root-count-mismatch");
        rootAnchors_ = std::move(captured);
        return roots;
    }
    static std::wstring normalizedImage(std::wstring path) {
        if (path.compare(0, 8, L"\\Device\\") == 0) {
            for (wchar_t letter = L'A'; letter <= L'Z'; ++letter) {
                const wchar_t drive[] = { letter, L':', 0 };
                wchar_t device[1024]{};
                if (QueryDosDeviceW(drive, device, static_cast<DWORD>(std::size(device)))) {
                    const std::wstring prefix(device);
                    if (path.size() > prefix.size() && recap::samePath(path.substr(0, prefix.size()), prefix))
                        return std::wstring(drive) + path.substr(prefix.size());
                }
            }
        }
        return recap::normalizedPath(path);
    }
    std::wstring executablePath(DWORD pid, const ProcessEvent& event) const {
        const ProcessGraph graph(processes_);
        const auto index = graph.unique(pid, event.timestamp);
        if (index == SIZE_MAX) return {};
        const auto& instance = graph.instances[index];
        for (const auto& registered : registrations_) {
            if (registered.pid == pid && registered.imageExact &&
                graph.unique(pid, static_cast<LONGLONG>(registered.witnessed)) == index) return registered.image;
        }
        const auto base = [](const std::wstring& path) { return path.substr(path.find_last_of(L"\\/") + 1); };
        const auto name = base(event.image);
        std::wstring found;
        for (const auto& value : actors_) {
            if (value.pid != pid || !value.instanceKnown || !value.liveAtCapture || value.image.empty() ||
                graph.unique(pid, static_cast<LONGLONG>(value.capturedQpc)) != index) continue;
            if (!found.empty() && !recap::samePath(found, value.image)) return {};
            found = value.image;
        }
        for (const auto& image : images_) {
            if (image.pid != pid || image.timestamp > instance.until || !recap::samePath(base(image.path), name)) continue;
            if (image.timestamp < instance.start.timestamp) {
                if (image.rundown != Rundown::begin || !instance.rundownBegin || instance.creationObserved ||
                    image.timestamp < static_cast<LONGLONG>(captureBegin_)) continue;
                bool competing = false;
                for (const auto& fact : processes_)
                    if (fact.pid == pid && fact.rundown == Rundown::none &&
                        fact.timestamp >= image.timestamp && fact.timestamp <= instance.start.timestamp) competing = true;
                for (size_t other = 0; other < graph.instances.size(); ++other) {
                    const auto& candidate = graph.instances[other];
                    if (other != index && candidate.start.pid == pid && candidate.until >= image.timestamp &&
                        candidate.start.timestamp <= instance.start.timestamp) competing = true;
                }
                if (competing) continue;
            }
            const auto path = normalizedImage(image.path);
            if (!found.empty() && !recap::samePath(found, path)) return {};
            found = path;
        }
        return found.empty() ? normalizedImage(event.image) : found;
    }
    void reportAttribution(std::ostream& report, const std::vector<WindowResolution>& resolution,
                           const std::vector<size_t>& offenders, const std::set<DWORD>& owned) {
        std::set<size_t> emitted;
        const auto emit = [&](size_t index, const char* category) {
            if (index >= windows_.size() || !emitted.insert(index).second) return;
            const auto& raw = windows_[index];
            const auto& row = resolution[index];
            const SourceResolution source = index < finalSources_.size() ? finalSources_[index] : SourceResolution{};
            report << "DIAG attribution category=" << category << " row=" << index << " reason=" << row.reason
                   << " event=" << raw.event << " object=" << raw.object << " child=" << raw.child
                   << " hwnd=" << raw.window << " callback_thread=" << raw.callbackThread
                   << " source_thread=" << raw.sourceThread
                   << " source_owner=" << raw.sourceOwner << " source_error=" << raw.sourceError
                   << " raw_owner=" << raw.owner << " raw_thread=" << raw.thread
                   << " source_actor=" << raw.sourceActor << " reported_actor=" << raw.reportedActor
                   << " source_thread_known=" << raw.sourceThreadKnown << " source_thread_creation=" << raw.sourceThreadCreation
                   << " source_retained=" << raw.sourceRetained
                   << " source_query_live=" << raw.sourceLive << " source_query_qpc=" << raw.sourceObservedQpc
                   << " recovered_source_known=" << source.known << " recovered_source_owner=" << source.owner
                   << " source_reason=" << source.reason << " source_from_retained=" << source.retained
                   << " source_from_live_query=" << source.liveQuery << " source_has_rundown=" << source.rundown
                   << " source_earliest_qpc=" << source.earliest << " source_latest_qpc=" << source.latest
                   << " source_process_interval=" << (source.process == SIZE_MAX ? -1LL : static_cast<long long>(source.process))
                   << " source_thread_interval=" << (source.thread == SIZE_MAX ? -1LL : static_cast<long long>(source.thread))
                   << " raw_kind=" << windowKindName(raw.kind) << " raw_identity=" << raw.identityKnown
                   << " raw_metadata=" << raw.metadataKnown << " raw_present=" << raw.present
                   << " raw_visible=" << raw.visible << " raw_geometry=" << raw.geometryKnown
                   << " raw_hierarchy=" << raw.hierarchyKnown << " raw_top=" << raw.topLevel
                   << " raw_onscreen=" << raw.onScreen << " left=" << raw.rectangle.left
                   << " top=" << raw.rectangle.top << " right=" << raw.rectangle.right << " bottom=" << raw.rectangle.bottom
                   << " generation32=" << raw.generated32 << " generation_tick=" << raw.generated
                   << " receipt_tick=" << raw.received.tick << " receipt_qpc=" << raw.received.qpc
                   << " lifetime=" << row.lifetime << " created=" << row.created << " destroyed=" << row.destroyed
                   << " lifetime_begin=" << row.beginTick << " lifetime_end=" << row.endTick
                   << " derived=" << row.derived << " evidence_row=" << (row.evidence == SIZE_MAX ? -1LL : static_cast<long long>(row.evidence))
                   << " resolved_owner=" << row.owner << " resolved_thread=" << row.thread
                   << " resolved_kind=" << windowKindName(row.kind)
                   << " console_bound=" << row.consoleBound << " complete_control=" << row.completeControl
                   << " presenter=" << row.presenter << " presenter_thread=" << row.presenterThread << " client=" << row.client
                   << " owned_role=" << (owned.count(row.owner) ? "owned" : "outside-owned")
                   << " conflict=" << row.conflict << " visibility_missing=" << row.visibilityMissing << "\n";
        };
        for (size_t count = 0; count < std::min<size_t>(20, offenders.size()); ++count) {
            const auto index = offenders[count];
            emit(index, "offending");
            size_t neighbors = 0;
            const auto evidence = resolution[index].evidence;
            if (evidence != SIZE_MAX && evidence != index) { emit(evidence, "identity-evidence"); ++neighbors; }
            for (size_t candidate = 0; candidate < windows_.size() && neighbors < 2; ++candidate) {
                if (candidate != index && windows_[candidate].window == windows_[index].window &&
                    !emitted.count(candidate)) { emit(candidate, "same-hwnd-context"); ++neighbors; }
            }
        }
        report << "DIAG attribution-summary offenders=" << offenders.size()
               << " omitted_offenders=" << (offenders.size() > 20 ? offenders.size() - 20 : 0)
               << " emitted_rows=" << emitted.size() << " total_window_rows=" << windows_.size()
               << " healthy=" << healthy() << " clocks=" << clockValid()
               << " etw_events_lost=" << eventsLost() << " etw_buffers_lost=" << buffersLost() << "\n";
        report.flush();
    }

    void reportCalibrationWindows(std::ostream& report, DWORD control, const WindowFact& sample,
                                  Moment begin, Moment beforeAttach) {
        reportCapture(report);
        reportBindings(report);
        uintptr_t window = sample.window;
        const char* source = window ? "sample" : "unavailable";
        if (!window) for (const auto& fact : consoles_) {
            if (fact.pid == control && fact.window) { window = fact.window; source = "console-event"; }
        }
        const auto rawSeen = [&](DWORD event) {
            return window && std::any_of(windows_.begin(), windows_.end(), [&](const auto& fact) {
                return fact.window == window && fact.event == event;
            });
        };
        report << "DIAG calibration-window hwnd=" << window << " window_source=" << source
               << " window_available=" << (window != 0) << " sample_available=" << (sample.window != 0)
               << " sample_owner=" << sample.owner << " sample_thread=" << sample.thread
               << " sample_kind=" << windowKindName(sample.kind) << " sample_identity=" << sample.identityKnown
               << " sample_metadata=" << sample.metadataKnown << " sample_geometry=" << sample.geometryKnown
               << " sample_hierarchy=" << sample.hierarchyKnown << " sample_present=" << sample.present
               << " sample_visible=" << sample.visible << " sample_top=" << sample.topLevel
               << " sample_onscreen=" << sample.onScreen << " sample_left=" << sample.rectangle.left
               << " sample_top_y=" << sample.rectangle.top << " sample_right=" << sample.rectangle.right
               << " sample_bottom=" << sample.rectangle.bottom << " sample_time_available=" << (sample.received.qpc != 0)
               << " sample_tick=" << sample.received.tick
               << " sample_qpc=" << sample.received.qpc << " control_available=" << (control != 0)
               << " console_start=" << (control && console(control))
               << " console_end=" << (control && console(control, EVENT_CONSOLE_END_APPLICATION))
               << " raw_create=" << rawSeen(EVENT_OBJECT_CREATE) << " raw_show=" << rawSeen(EVENT_OBJECT_SHOW)
               << " raw_hide=" << rawSeen(EVENT_OBJECT_HIDE) << " raw_destroy=" << rawSeen(EVENT_OBJECT_DESTROY)
               << " strict_create=" << (window && windowEventSeen(window, EVENT_OBJECT_CREATE))
               << " strict_show=" << (window && windowEventSeen(window, EVENT_OBJECT_SHOW))
               << " strict_hide=" << (window && windowEventSeen(window, EVENT_OBJECT_HIDE))
               << " strict_destroy=" << (window && windowEventSeen(window, EVENT_OBJECT_DESTROY))
               << " passive_fence_available=" << (window && beforeAttach.qpc != 0)
               << " passive_fence=" << (window && beforeAttach.qpc &&
                   passiveVisible(window, begin.tick, beforeAttach.tick + 1, beforeAttach.qpc))
               << " healthy=" << healthy() << " clocks=" << clockValid() << " stopped=" << stopped_ << "\n";
        const auto resolution = resolvedWindows();
        std::vector<size_t> context;
        for (size_t index = 0; index < windows_.size(); ++index)
            if (!window || windows_[index].window == window) context.push_back(index);
        std::set<DWORD> owned{ GetCurrentProcessId() };
        if (control) owned.insert(control);
        reportAttribution(report, resolution, context, owned);
    }

    void reportClientWindows(std::ostream& report, const std::set<DWORD>& clients) {
        reportBindings(report);
        const auto resolution = resolvedWindows();
        std::vector<size_t> context;
        for (size_t index = 0; index < windows_.size(); ++index) {
            const auto& raw = windows_[index];
            const auto& row = resolution[index];
            if (clients.count(raw.owner) || clients.count(row.client) ||
                std::any_of(clients.begin(), clients.end(), [&](DWORD pid) { return potentialConsole(pid, raw, row); }))
                context.push_back(index);
        }
        reportAttribution(report, resolution, context, clients);
    }

    std::set<size_t> requireCalibrationLifetimes(const std::vector<WindowFact>& controls, std::ostream& report,
                                               const std::vector<WindowResolution>& resolution) {
        std::set<size_t> result;
        for (const auto& known : controls) {
            std::set<size_t> candidates;
            std::vector<size_t> context;
            for (size_t index = 0; index < windows_.size(); ++index) {
                if (windows_[index].window != known.window) continue;
                context.push_back(index);
                const auto& row = resolution[index];
                if (row.identityKnown && !row.conflict && row.consoleBound && row.completeControl &&
                    row.created && row.destroyed && row.client == known.owner && row.thread == known.thread &&
                    row.kind == known.kind && row.beginTick <= known.received.tick && known.received.tick <= row.endTick)
                    candidates.insert(row.lifetime);
            }
            if (candidates.size() != 1) {
                reportBindings(report);
                reportAttribution(report, resolution, context, {});
                throw std::runtime_error("calibration window lifetime made passive observation inconclusive");
            }
            result.insert(*candidates.begin());
        }
        check(result.size() == controls.size(), "calibration controls did not have distinct complete lifetimes");
        return result;
    }
    void assertCalibrations(const std::vector<WindowFact>& controls, std::ostream& report) {
        check(stopped_ && controls.size() == 2 && clockValid(), "calibration preflight was incomplete");
        reportCapture(report);
        assertHealthy();
        {
            std::lock_guard<std::mutex> lock(mutex_);
            const ThreadGraph threads(threads_);
            report << "DIAG calibration-thread-identities instances=" << threads.instances.size() << "\n";
            report.flush();
        }
        const auto resolution = resolvedWindows();
        requireCalibrationLifetimes(controls, report, resolution);
        reportBindings(report);
    }

    void assertNoVisibleTerminals(const std::vector<DWORD>& roots,
                                 const std::vector<WindowFact>& controls, std::ostream& report) {
        reportTo(report);
        try {
            finalSection("final-capture-health");
            finalRequire(stopped_ && windowObservation_, "final-capture-not-stopped");
            reportCapture(report);
            finalRequire(healthy(), "final-capture-unhealthy");
            finalRequire(clockValid(), "final-clock-invalid");
            finalRequire(controls.size() == 2, "final-control-count");
            const bool installed = profile_ == ObservationProfile::installedFunctionality;
            report << "DIAG observation-profile profile=" << profileName(profile_) << " fixed_fixture=" << fixedFixtureSource_
                   << " criterion=controlled-app-terminal-presentation\n";
            const auto resolution = resolvedWindows();
            const auto bindings = consoleBindings();
            const ProcessGraph graph(processes());
            finalSection("final-source-lifetimes");
            finalSources_ = sourceSnapshot(graph, report);
            finalRequire(healthy(), "final-capture-unhealthy");

            finalSection("final-process-graph");
            finalExpectedRoots_ = roots.size();
            finalActualRoots_ = rootAnchors_.size();
            finalRequire(!roots.empty() && roots.size() == rootAnchors_.size(), "final-root-registration-missing");
            std::set<size_t> rootInstances;
            std::set<std::wstring> packageRuntimes;
            for (size_t index = 0; index < roots.size(); ++index) {
                const auto& anchor = rootAnchors_[index];
                finalContextPids_.insert(anchor.pid);
                finalRequire(roots[index] == anchor.pid, "final-root-pid-mismatch", roots[index]);
                finalRequire(!graph.at(anchor.pid, anchor.point).empty(), "final-root-instance-missing", anchor.pid);
                const auto node = anchor.exactStart ? graph.exact(anchor.pid, anchor.point) : graph.unique(anchor.pid, anchor.point);
                finalRequire(node != SIZE_MAX, "final-root-instance-ambiguous", anchor.pid);
                const auto& value = graph.instances[node];
                finalRequire(recap::samePath(executablePath(anchor.pid, value.start), anchor.image),
                             "final-root-image-mismatch", anchor.pid);
                finalRequire(value.ended && value.end.exitKnown, "final-root-exit-mismatch", anchor.pid);
                rootInstances.insert(node);
                packageRuntimes.insert(anchor.image.substr(0, anchor.image.find_last_of(L'\\')) + L"\\runtime\\node.exe");
            }
            const auto lineage = graph.descendants(rootInstances);
            finalRequire(lineage.ambiguous == SIZE_MAX, "final-lineage-ambiguous",
                         lineage.ambiguous < graph.instances.size() ? graph.instances[lineage.ambiguous].start.pid : 0);
            finalRequire(lineage.missingParent == SIZE_MAX, "final-parent-interval-missing",
                         lineage.missingParent < graph.instances.size() ? graph.instances[lineage.missingParent].start.pid : 0);
            std::set<DWORD> ownedPids;
            for (const auto index : lineage.owned) ownedPids.insert(graph.instances[index].start.pid);

            finalSection("final-role-coverage");
            bool coordinator = false, verifier = false, server = false, browser = false;
            wchar_t system[32768]{};
            const auto systemLength = GetSystemDirectoryW(system, static_cast<UINT>(std::size(system)));
            finalRequire(systemLength && systemLength < std::size(system), "final-system-root-unavailable");
            for (const auto index : lineage.owned) {
                const auto& value = graph.instances[index];
                const auto& event = value.start;
                const auto pid = event.pid;
                const auto path = executablePath(pid, event);
                const auto runtime = std::any_of(packageRuntimes.begin(), packageRuntimes.end(),
                    [&](const auto& expected) { return recap::samePath(path, expected); });
                if (event.command.find(L"Launcher.mjs") != std::wstring::npos) {
                    coordinator = true;
                    finalRequire(runtime, "final-coordinator-image-mismatch", pid);
                    finalRequire(event.command.find(L"--gui-startup-v1") != std::wstring::npos, "final-coordinator-arguments", pid);
                    finalRequire(value.ended, "final-coordinator-exit-missing", pid);
                }
                if (event.command.find(L"server.mjs") != std::wstring::npos) {
                    server = true;
                    finalRequire(runtime, "final-server-image-mismatch", pid);
                }
                const auto name = path.substr(path.find_last_of(L"\\/") + 1);
                if (recap::samePath(name, L"powershell.exe")) {
                    verifier = true;
                    finalRequire(recap::samePath(path, std::wstring(system) + L"\\WindowsPowerShell\\v1.0\\powershell.exe"),
                                 "final-verifier-image-mismatch", pid);
                    finalRequire(value.ended, "final-verifier-exit-missing", pid);
                }
                if (recap::samePath(name, L"cmd.exe")) {
                    browser = true;
                    finalRequire(recap::samePath(path, std::wstring(system) + L"\\cmd.exe"), "final-browser-image-mismatch", pid);
                    finalRequire(event.command.find(L"http://127.0.0.1:8787/") != std::wstring::npos,
                                 "final-browser-origin-mismatch", pid);
                    finalRequire(value.ended, "final-browser-exit-missing", pid);
                }
            }
            report << "DIAG final-roles roots=" << rootInstances.size() << " owned_instances=" << lineage.owned.size()
                   << " total_instances=" << graph.instances.size() << " coordinator=" << coordinator
                   << " verifier=" << verifier << " server=" << server << " browser=" << browser << "\n";
            finalRequire(coordinator, "final-coordinator-role-missing");
            finalRequire(!installed || (verifier && server && browser), "final-installed-roles-missing");

            finalSection("final-calibration-lifetimes");
            std::set<size_t> calibrationLifetimes;
            try { calibrationLifetimes = requireCalibrationLifetimes(controls, report, resolution); }
            catch (const std::exception&) { finalRequire(false, "final-calibration-lifetime-invalid"); }
            finalSection("final-console-bindings");
            reportBindings(report);
            finalSection("final-window-attribution");
            const auto lifetimes = windowLifetimes(windows_);
            std::set<size_t> guiTransientRows, observerTransientRows, environmentRows;
            size_t guiTransients = 0, observerTransients = 0, environmentMissingParents = 0;
            for (const auto& life : lifetimes) {
                if (const auto* source = transientSource(life, graph, finalSources_)) {
                    auto& rows = source->purpose == RegisteredPurpose::product ? guiTransientRows : observerTransientRows;
                    rows.insert(life.rows.begin(), life.rows.end());
                    if (source->purpose == RegisteredPurpose::product) ++guiTransients;
                    else ++observerTransients;
                } else {
                    const auto environment = environmentWindow(life, graph, finalSources_);
                    if (environment.allowed) {
                        environmentRows.insert(life.rows.begin(), life.rows.end());
                        if (!environment.parentKnown) environmentMissingParents += life.rows.size();
                    }
                }
            }
            std::vector<size_t> inconclusive, visible, unboundConsole;
            std::set<size_t> ambientConsoles, visibleAmbientConsoles;
            size_t helperExcluded = 0, helperUnknown = 0, rawUnknown = 0, scopedUnknown = 0;
            for (size_t index = 0; index < windows_.size(); ++index) {
                const auto& raw = windows_[index];
                const auto& identity = resolution[index];
                if (!raw.metadataKnown) ++rawUnknown;
                if (identity.identityKnown && !identity.conflict && calibrationLifetimes.count(identity.lifetime)) continue;
                if (guiTransientRows.count(index) || observerTransientRows.count(index) || environmentRows.count(index)) {
                    if (!raw.metadataKnown) ++scopedUnknown;
                    continue;
                }
                const auto scope = helperScope(raw, finalSources_[index], graph, lineage.owned);
                if (verifiedHelperSurface(raw, scope)) {
                    ++helperExcluded;
                    if (!raw.metadataKnown) ++helperUnknown;
                    continue;
                }
                const bool possibleConsole = std::any_of(consoles_.begin(), consoles_.end(), [&](const auto& event) {
                    return event.window && event.window == raw.window &&
                        event.generated >= identity.beginTick && event.generated <= identity.endTick;
                });
                const bool verifiedAmbient = std::any_of(bindings.begin(), bindings.end(), [&](const auto& binding) {
                    return binding.lifetime == identity.lifetime && ambientConsoleScoped(profile_, fixedFixtureSource_, binding);
                });
                if (identity.consoleBound && identity.ambientConsole && verifiedAmbient && !identity.conflict && !identity.visibilityMissing) {
                    ambientConsoles.insert(identity.lifetime);
                    if (visibleBoundConsole(raw, identity)) visibleAmbientConsoles.insert(identity.lifetime);
                    if (!raw.metadataKnown) ++scopedUnknown;
                    continue;
                }
                if ((identity.kind == WindowKind::console || possibleConsole) && !identity.consoleBound) {
                    unboundConsole.push_back(index);
                } else if (!identity.identityKnown || identity.conflict || identity.visibilityMissing ||
                    (identity.kind == WindowKind::terminal && raw.event == EVENT_OBJECT_CREATE && !raw.metadataKnown)) {
                    inconclusive.push_back(index);
                } else {
                    const auto measured = effectiveWindow(raw, identity);
                    const bool terminal = identity.kind == WindowKind::console || identity.kind == WindowKind::terminal;
                    if (!terminal || !visibleIn(measured, 0, UINT64_MAX)) continue;
                    auto owner = graph.unique(identity.owner, static_cast<LONGLONG>(raw.received.qpc));
                    if (identity.consoleBound) for (const auto& binding : bindings) {
                        if (binding.lifetime != identity.lifetime) continue;
                        const auto* client = actor(binding.clientActor);
                        if (client) owner = graph.unique(client->pid, static_cast<LONGLONG>(client->capturedQpc));
                    }
                    if (owner != SIZE_MAX && lineage.owned.count(owner)) visible.push_back(index);
                    else inconclusive.push_back(index);
                }
            }
            report << "DIAG final-scope excluded_helpers=" << helperExcluded << " unavailable_helper_metadata=" << helperUnknown
                   << " reason=verified-registered-nonterminal-helper retained_raw=1 controls=" << calibrationLifetimes.size() << "\n";
            report << "DIAG terminal-scope profile=" << profileName(profile_) << " gui_transients=" << guiTransients
                   << " gui_transient_rows=" << guiTransientRows.size() << " observer_transients=" << observerTransients
                   << " observer_transient_rows=" << observerTransientRows.size() << " environment_rows=" << environmentRows.size()
                   << " environment_parent_unproved_rows=" << environmentMissingParents
                   << " environment_basis=" << (profile_ == ObservationProfile::nativeFixture ? "fixed-executable-capabilities" : "none")
                   << " raw_unknown_metadata=" << rawUnknown << " scoped_unknown_metadata=" << scopedUnknown << "\n";
            report << "DIAG terminal-coverage product_visible_rows=" << visible.size()
                   << " visible_ambient_consoles=" << visibleAmbientConsoles.size() << " ambient_console_lifetimes=" << ambientConsoles.size()
                   << " unresolved_rows=" << inconclusive.size() + unboundConsole.size() << " raw_facts_preserved=1\n";
            const auto reportRows = [&](const std::vector<size_t>& rows) {
                finalContextPids_.clear();
                for (const auto index : rows) {
                    if (finalSources_[index].known) finalContextPids_.insert(finalSources_[index].owner);
                    if (windows_[index].sourceOwner) finalContextPids_.insert(windows_[index].sourceOwner);
                    if (windows_[index].owner) finalContextPids_.insert(windows_[index].owner);
                }
                reportAttribution(report, resolution, rows, ownedPids);
            };
            if (!unboundConsole.empty()) {
                reportRows(unboundConsole);
                finalRequire(false, "final-console-binding-unresolved", 0, windows_[unboundConsole.front()].window);
            }
            if (!inconclusive.empty()) {
                reportRows(inconclusive);
                finalRequire(false, "final-window-scope-inconclusive", 0, windows_[inconclusive.front()].window);
            }
            if (!visible.empty()) {
                reportRows(visible);
                finalRequire(false, "final-visible-product-terminal", 0, windows_[visible.front()].window);
            }
            report << "CHECK EXIT " << finalStage_ << "\nCHECK EXIT final-observer-closure\n";
            finalSectionOpen_ = false;
            report.flush();
        } catch (const FinalObservationFailure&) {
            throw;
        } catch (const std::exception&) {
            finalRequire(false, "final-context-exception", finalPid_, finalWindow_);
        }
    }
};
} // namespace proof
