#include "StartupProtocol.h"
#include "StartupProcess.h"
#include "StartupObserver.h"
#include <ole2.h>
#include <UIAutomation.h>
#include <wincrypt.h>
#include <array>
#include <cstdlib>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string_view>
#include <system_error>
#include <type_traits>

namespace fs = std::filesystem;
using proof::check;

namespace {
std::ofstream* liveReport = nullptr;
fs::path liveReportPath;
std::string lastStage = "not-started";

struct WindowMessageFailure : std::runtime_error {
    UINT message;
    DWORD error;
    uint64_t elapsed;
    WindowMessageFailure(UINT id, DWORD code, uint64_t duration)
        : std::runtime_error("window-message-failed"), message(id), error(code), elapsed(duration) {}
};

struct FixtureRecordFailure : std::runtime_error {
    const char* code;
    size_t bytes;
    FixtureRecordFailure(const char* condition, size_t size) : std::runtime_error(condition), code(condition), bytes(size) {}
};

struct FixtureSetupFailure : std::runtime_error {
    const char* code;
    const char* stage;
    const char* category;
    long long numeric;
    std::exception_ptr primary;
    FixtureSetupFailure(const char* condition, const char* section, const char* kind, long long value, std::exception_ptr error)
        : std::runtime_error(condition), code(condition), stage(section), category(kind), numeric(value), primary(std::move(error)) {}
};

struct FixtureSetupContext {
    std::string fixture;
    DWORD gui = 0, coordinator = 0, sentinel = 0;
    size_t recordBytes = 0;
    bool recordReady = false, recordParsed = false, clientRetained = false;
};

struct CalibrationFailure : std::runtime_error {
    const char* code;
    const char* stage;
    std::exception_ptr primary;
    std::vector<std::exception_ptr> secondary;
    CalibrationFailure(const char* errorCode, const char* failedStage, std::exception_ptr original,
                       std::vector<std::exception_ptr> additional)
        : std::runtime_error("calibration-failed"), code(errorCode), stage(failedStage),
          primary(std::move(original)), secondary(std::move(additional)) {}
};

const char* failureCode(const std::exception& failure) {
    if (const auto* setup = dynamic_cast<const FixtureSetupFailure*>(&failure)) return setup->code;
    if (const auto* record = dynamic_cast<const FixtureRecordFailure*>(&failure)) return record->code;
    if (const auto* final = dynamic_cast<const proof::FinalObservationFailure*>(&failure)) return final->code;
    if (dynamic_cast<const WindowMessageFailure*>(&failure)) return "window-message-failed";
    if (const auto* calibration = dynamic_cast<const CalibrationFailure*>(&failure)) return calibration->code;
    static constexpr const char* labels[][2] = {
        { "N1 missing frame was accepted as opened", "n1-missing-frame-accepted" },
        { "F03 pending close lost the startup owner", "n2-pending-owner-lost" },
        { "F01 coordinator created a visible terminal", "n3-visible-coordinator-terminal" },
        { "LC-001 failure rectangle escaped the current monitor work area", "lc001-failure-outside-work-area" },
        { "observer did not detect its console control", "calibration-console-start-missing" },
        { "calibration did not expose a passive visible terminal", "calibration-passive-terminal-missing" },
        { "observer could not release its previous console", "calibration-previous-console-release-failed" },
        { "calibration console attachment was inconclusive", "calibration-attachment-inconclusive" },
        { "calibration console did not become attachable", "calibration-attachment-timeout" },
        { "calibration membership was incomplete", "calibration-membership-incomplete" },
        { "calibration console membership did not match its owned processes", "calibration-membership-mismatch" },
        { "calibration visible console window could not be mapped", "calibration-window-unmapped" },
        { "calibration window create/show events were incomplete", "calibration-window-events-incomplete" },
        { "observer did not detect console control exit", "calibration-console-end-missing" },
        { "observer could not detach the calibration console", "calibration-detach-failed" },
        { "calibration window destroy event was incomplete", "calibration-window-destroy-missing" },
        { "control sample primary thread differed", "control-primary-thread-mismatch" },
        { "control sample console association differed", "control-window-association-mismatch" },
        { "control binding requires exactly its client and observer", "control-membership-binding-mismatch" },
        { "control departure was not confirmed on its retained instance", "control-departure-unconfirmed" },
        { "remaining attached observer association was not confirmed", "observer-membership-unconfirmed" },
        { "observer detach association was not confirmed", "observer-detach-unconfirmed" },
        { "passive F01 observation fence did not complete", "product-terminal-binding-inconclusive" },
        { "unmapped window lifecycle made passive observation inconclusive", "window-lifecycle-inconclusive" },
        { "calibration window lifetime made passive observation inconclusive", "calibration-lifetime-inconclusive" },
        { "product process created a visible terminal", "product-visible-terminal" },
        { "pending footer text is missing or changed", "pending-footer-text-mismatch" },
        { "pending footer is not visible within the client", "pending-footer-bounds-invalid" },
        { "pending footer text ink was not captured", "pending-footer-ink-missing" },
        { "owned client repaint failed", "owned-client-repaint-failed" },
        { "registration process identity unavailable", "process-registration-identity-unavailable" },
        { "registration purpose or image conflict", "process-registration-purpose-conflict" },
        { "registration requires a retained live process instance", "process-registration-not-live" },
        { "registered process image differs from its declared purpose", "process-registration-image-mismatch" },
        { "registered primary thread instance differs", "process-registration-thread-mismatch" },
        { "lifetime identity bound exceeded", "lifetime-identity-bound" },
        { "ETW thread record bound exceeded", "thread-record-bound" },
        { "semantic record byte bound differs", "semantic-record-bound" },
        { "semantic record changed or has invalid controls", "semantic-record-invalid" },
        { "semantic text byte bound differs", "semantic-text-bound" },
        { "semantic text is not UTF-8", "semantic-text-invalid" },
        { "semantic text decoding failed", "semantic-text-decode-failed" },
        { "semantic publication target or size differs", "semantic-publication-invalid" },
        { "semantic caller record shape differs", "semantic-caller-record-invalid" },
        { "semantic caller architecture differs", "semantic-caller-architecture-mismatch" },
        { "semantic begin record shape differs", "semantic-begin-record-invalid" },
        { "semantic end record shape differs", "semantic-end-record-invalid" },
        { "semantic caller input is invalid", "semantic-caller-input-invalid" },
        { "semantic caller instance unavailable", "semantic-caller-instance-unavailable" },
        { "semantic caller creation unavailable", "semantic-caller-creation-unavailable" },
        { "semantic caller image or proof module differs", "semantic-caller-image-or-module-mismatch" },
        { "semantic operation order differs", "semantic-operation-order" },
        { "semantic operation end differs", "semantic-operation-end" },
        { "semantic operation name is invalid", "semantic-operation-name" },
        { "semantic channel did not finish", "semantic-channel-deadline" },
        { "semantic command arguments unavailable", "semantic-command-unavailable" },
        { "semantic command argument bound exceeded", "semantic-command-bound" },
        { "semantic command allocation cleanup failed", "semantic-command-cleanup" },
        { "semantic image context bound exceeded", "semantic-image-context-bound" },
        { "native closed profile requires the exact reviewed inert fixture", "native-fixture-contract-mismatch" },
        { "fixed fixture digest could not be verified", "native-fixture-digest-failed" },
        { "fixture process creation failed", "fixture-gui-create-failed" },
        { "inheritable sentinel unavailable", "fixture-inheritance-sentinel-missing" },
        { "native window did not appear", "fixture-gui-window-missing" },
        { "coordinator fixture did not start", "fixture-observed-record-not-ready" },
        { "detached fixture sentinel absent", "fixture-sentinel-record-not-ready" },
        { "fixture child ownership could not be retained", "fixture-client-retention-failed" },
        { "fixture child image differs", "fixture-client-image-mismatch" },
        { "client process instance changed", "fixture-client-instance-conflict" },
        { "client process identity unavailable", "fixture-client-identity-unavailable" },
        { "returned primary thread identity differed", "fixture-primary-thread-mismatch" },
        { "native architecture could not be observed", "fixture-architecture-unavailable" },
        { "ARM64 proof is not native", "fixture-architecture-not-arm64" },
        { "x64 proof is not native", "fixture-architecture-not-x64" },
        { "fixture output could not be written", "fixture-scenario-write-failed" },
        { "identity handle duplication failed", "fixture-identity-duplicate-failed" },
        { "client identity bound exceeded", "fixture-client-capacity" },
        { "registered process bound exceeded", "fixture-registration-capacity" },
        { "returned primary thread could not be bound", "fixture-primary-thread-unavailable" }
    };
    for (const auto& label : labels) if (strcmp(failure.what(), label[0]) == 0) return label[1];
    return "unclassified-proof-error";
}

void writeFailure(std::ostream& report, const std::exception& failure, const std::string& stage) {
    report << "FAIL code=" << failureCode(failure) << " stage=" << stage << "\n";
    if (const auto* calibration = dynamic_cast<const CalibrationFailure*>(&failure))
        report << "DIAG calibration-exception primary=1 secondary_failures=" << calibration->secondary.size() << "\n";
    if (const auto* leaf = dynamic_cast<const WindowMessageFailure*>(&failure))
        report << "DIAG failed-leaf stage=window-message message=" << leaf->message
               << " error=" << leaf->error << " elapsed_ms=" << leaf->elapsed << "\n";
    if (const auto* setup = dynamic_cast<const FixtureSetupFailure*>(&failure))
        report << "DIAG fixture-native-failure category=" << setup->category << " numeric=" << setup->numeric
               << " condition=" << setup->code << " stage=" << setup->stage << "\n";
    report.flush();
}

void checkpoint(const char* edge, const char* stage) {
    lastStage = stage;
    if (!liveReport) return;
    *liveReport << "CHECK " << edge << " " << stage << " tick=" << GetTickCount64() << "\n";
    liveReport->flush();
}

template<class Action>
auto observed(const char* stage, Action action) {
    checkpoint("ENTER", stage);
    try {
        if constexpr (std::is_void_v<decltype(action())>) {
            action();
            checkpoint("EXIT", stage);
        } else {
            auto result = action();
            checkpoint("EXIT", stage);
            return result;
        }
    } catch (const std::exception&) {
        checkpoint("FAIL", stage);
        throw;
    }
}

template<class Action>
auto fixtureSetup(const char* stage, FixtureSetupContext& context, Action action) {
    checkpoint("ENTER", stage);
    try {
        if constexpr (std::is_void_v<decltype(action())>) {
            action();
            checkpoint("EXIT", stage);
        } else {
            auto result = action();
            checkpoint("EXIT", stage);
            return result;
        }
    } catch (const std::exception& error) {
        const char* code = failureCode(error);
        const char* category = "condition";
        long long numeric = 0;
        if (const auto* record = dynamic_cast<const FixtureRecordFailure*>(&error)) {
            context.recordBytes = record->bytes;
            category = "record";
        } else if (const auto* file = dynamic_cast<const fs::filesystem_error*>(&error)) {
            code = "fixture-setup-filesystem-error"; category = "filesystem"; numeric = file->code().value();
        } else if (const auto* stream = dynamic_cast<const std::ios_base::failure*>(&error)) {
            code = "fixture-setup-stream-error"; category = "stream"; numeric = stream->code().value();
        } else if (const auto* system = dynamic_cast<const std::system_error*>(&error)) {
            code = "fixture-setup-system-error"; category = "system"; numeric = system->code().value();
        } else if (dynamic_cast<const std::invalid_argument*>(&error) || dynamic_cast<const std::out_of_range*>(&error)) {
            code = "fixture-setup-numeric-error"; category = "numeric";
        } else if (std::string_view(code) == "unclassified-proof-error") {
            code = "fixture-setup-unexpected"; category = "unexpected";
        }
        checkpoint("FAIL", stage);
        if (liveReport) {
            *liveReport << "DIAG fixture-setup fixture=" << context.fixture << " stage=" << stage
                        << " condition=" << code << " category=" << category << " numeric=" << numeric
                        << " gui_pid=" << context.gui << " coordinator_pid=" << context.coordinator
                        << " sentinel_pid=" << context.sentinel << " record_bytes=" << context.recordBytes
                        << " record_ready=" << context.recordReady << " record_parsed=" << context.recordParsed
                        << " client_retained=" << context.clientRetained << "\n";
            liveReport->flush();
        }
        throw FixtureSetupFailure(code, stage, category, numeric, std::current_exception());
    }
}

struct PollingObservation {
    std::ostream& report;
    const char* stage;
    uint64_t started, lastHeartbeat, polls = 0, messages = 0, succeeded = 0, slow = 0, maximumMessageMs = 0;
    size_t records = 0;
    PollingObservation(std::ostream& output, const char* name, uint64_t now)
        : report(output), stage(name), started(now), lastHeartbeat(now) { emit("ENTER", now); }
    void emit(const char* edge, uint64_t now) {
        report << "CHECK " << edge << " " << stage << " tick=" << now << " elapsed_ms=" << now - started
               << " polls=" << polls << " messages=" << messages << " succeeded=" << succeeded
               << " slow_messages=" << slow << " max_message_ms=" << maximumMessageMs << "\n";
        ++records;
        report.flush();
    }
    void progress(uint64_t now) {
        check(now >= lastHeartbeat, "poll observation clock reversed");
        if (now - lastHeartbeat >= 2000) { emit("INFO", now); lastHeartbeat = now; }
    }
    void message(UINT id, bool success, DWORD error, uint64_t elapsed, uint64_t now) {
        ++messages;
        maximumMessageMs = std::max(maximumMessageMs, elapsed);
        if (!success) {
            report << "CHECK FAIL window-message scope=" << stage << " message=" << id
                   << " error=" << error << " elapsed_ms=" << elapsed << " tick=" << now
                   << " polls=" << polls << " messages=" << messages << " succeeded=" << succeeded << "\n";
            ++records;
            report.flush();
            throw WindowMessageFailure(id, error, elapsed);
        }
        ++succeeded;
        if (elapsed >= 100 && ++slow == 1) {
            report << "DIAG poll-leaf-slow scope=" << stage << " message=" << id
                   << " elapsed_ms=" << elapsed << " tick=" << now << "\n";
            ++records;
            report.flush();
        }
    }
};

PollingObservation* activePolling = nullptr;

template<class Predicate>
void observedWait(const char* stage, Predicate predicate, const char* failure, DWORD timeout = 15000) {
    check(liveReport != nullptr, "poll observation requires its report");
    PollingObservation observation(*liveReport, stage, GetTickCount64());
    auto* previous = std::exchange(activePolling, &observation);
    lastStage = stage;
    try {
        proof::until([&] {
            ++observation.polls;
            const bool ready = predicate();
            observation.progress(GetTickCount64());
            return ready;
        }, failure, timeout);
        observation.emit("EXIT", GetTickCount64());
        activePolling = previous;
    } catch (const std::exception&) {
        observation.emit("FAIL", GetTickCount64());
        activePolling = previous;
        throw;
    }
}

DWORD_PTR sendChecked(HWND window, UINT message, WPARAM wparam = 0, LPARAM lparam = 0) {
    check(window != nullptr && message < WM_USER, "unsupported cross-process message or window");
    const auto invoke = [&] {
        const auto begin = GetTickCount64();
        DWORD_PTR result = 0;
        SetLastError(ERROR_SUCCESS);
        const bool success = SendMessageTimeoutW(window, message, wparam, lparam,
            SMTO_ABORTIFHUNG | SMTO_ERRORONEXIT, 2000, &result) != 0;
        const auto error = success ? ERROR_SUCCESS : GetLastError();
        const auto end = GetTickCount64();
        if (!success) lastStage = "window-message";
        if (activePolling) activePolling->message(message, success, error, end - begin, end);
        if (!success) {
            if (liveReport) {
                *liveReport << "DIAG failed-leaf stage=window-message message=" << message
                            << " error=" << error << " elapsed_ms=" << end - begin << "\n";
                liveReport->flush();
            }
            throw WindowMessageFailure(message, error, end - begin);
        }
        return result;
    };
    const bool repeatedRead = activePolling && (message == WM_GETTEXTLENGTH || message == WM_GETTEXT);
    return repeatedRead ? invoke() : observed("window-message", invoke);
}

struct StopResult {
    bool complete = false, terminationAttempted = false, terminationSucceeded = false;
    DWORD initialWait = WAIT_FAILED, finalWait = WAIT_FAILED, waitError = 0, terminationError = 0;
};

template<class Operations>
StopResult stopOwned(Operations& operations, uint64_t timeout = recap::CleanupTimeout) {
    StopResult result;
    const auto deadline = operations.now() + timeout;
    result.initialWait = operations.wait(0);
    result.finalWait = result.initialWait;
    if (result.initialWait == WAIT_OBJECT_0) { result.complete = true; return result; }
    if (result.initialWait != WAIT_TIMEOUT) {
        result.waitError = result.initialWait == WAIT_FAILED ? operations.error() : ERROR_INVALID_DATA;
        return result;
    }
    result.terminationAttempted = true;
    result.terminationSucceeded = operations.terminate();
    if (!result.terminationSucceeded) result.terminationError = operations.error();
    for (;;) {
        const auto now = operations.now();
        const auto remaining = now < deadline ? std::min<uint64_t>(20, deadline - now) : 0;
        result.finalWait = operations.wait(static_cast<DWORD>(remaining));
        if (result.finalWait == WAIT_OBJECT_0) {
            result.complete = operations.now() <= deadline &&
                (result.terminationSucceeded || result.terminationError == ERROR_ACCESS_DENIED);
            return result;
        }
        if (result.finalWait != WAIT_TIMEOUT) {
            result.waitError = result.finalWait == WAIT_FAILED ? operations.error() : ERROR_INVALID_DATA;
            return result;
        }
        if (operations.now() >= deadline) return result;
    }
}

struct StopOperations {
    HANDLE process;
    DWORD lastError = 0;
    uint64_t now() const { return GetTickCount64(); }
    DWORD wait(DWORD timeout) {
        const auto result = WaitForSingleObject(process, timeout);
        lastError = result == WAIT_FAILED ? GetLastError() : 0;
        return result;
    }
    bool terminate() {
        const bool result = TerminateProcess(process, 2) != FALSE;
        lastError = result ? 0 : GetLastError();
        return result;
    }
    DWORD error() const { return lastError; }
};

struct Child {
    recap::Handle process;
    recap::Handle primaryThread;
    DWORD pid = 0, primaryTid = 0;
    StopResult cleanup;
    unsigned int stopCalls = 0;
    ~Child() {
        if (process && WaitForSingleObject(process.get(), 0) == WAIT_TIMEOUT) {
            TerminateProcess(process.get(), 2);
            WaitForSingleObject(process.get(), 2000);
        }
    }
    bool completed() const {
        check(static_cast<bool>(process), "owned completion handle is missing");
        const auto result = WaitForSingleObject(process.get(), 0);
        if (result == WAIT_FAILED)
            throw std::runtime_error("owned completion wait failed error=" + std::to_string(GetLastError()));
        check(result == WAIT_OBJECT_0 || result == WAIT_TIMEOUT, "owned completion wait returned an invalid status");
        return result == WAIT_OBJECT_0;
    }
    DWORD exit() const {
        if (!completed()) return STILL_ACTIVE;
        DWORD code = STILL_ACTIVE;
        if (!GetExitCodeProcess(process.get(), &code))
            throw std::runtime_error("owned exit query failed error=" + std::to_string(GetLastError()));
        return code;
    }
    void stop(uint64_t timeout = recap::CleanupTimeout) {
        checkpoint("ENTER", "owned-process-cleanup");
        ++stopCalls;
        if (!process) {
            check(pid == 0, "owned cleanup lost a retained process handle");
            cleanup.complete = true;
            cleanup.initialWait = cleanup.finalWait = WAIT_OBJECT_0;
            checkpoint("EXIT", "owned-process-cleanup");
            return;
        }
        if (cleanup.complete) {
            check(completed(), "previously completed owned handle is no longer signaled");
            checkpoint("EXIT", "owned-process-cleanup");
            return;
        }
        StopOperations operations{ process.get() };
        cleanup = stopOwned(operations, timeout);
        if (!cleanup.complete)
            throw std::runtime_error("owned fixture cleanup failed pid=" + std::to_string(pid) +
                " wait=" + std::to_string(cleanup.finalWait) + " wait_error=" + std::to_string(cleanup.waitError) +
                " terminate_error=" + std::to_string(cleanup.terminationError));
        checkpoint("EXIT", "owned-process-cleanup");
    }
};

void start(Child& child, const std::wstring& executable, const std::wstring& arguments = L"",
           DWORD flags = CREATE_NO_WINDOW, BOOL inherit = FALSE) {
    auto command = recap::quoted(executable) + (arguments.empty() ? L"" : L" " + arguments);
    STARTUPINFOW startup{ sizeof(STARTUPINFOW) };
    PROCESS_INFORMATION process{};
    observed("fixture-process-create", [&] {
        if (!CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, inherit, flags,
            nullptr, nullptr, &startup, &process))
            throw std::system_error(static_cast<int>(GetLastError()), std::system_category(), "fixture-process-create");
    });
    child.process = recap::Handle(process.hProcess);
    child.primaryThread = recap::Handle(process.hThread);
    child.pid = process.dwProcessId;
    child.primaryTid = process.dwThreadId;
    child.cleanup = {};
    child.stopCalls = 0;
}

void retain(Child& child, DWORD pid, const std::wstring& expected) {
    recap::Handle candidate(OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION |
        PROCESS_TERMINATE | PROCESS_DUP_HANDLE, FALSE, pid));
    if (!candidate)
        throw std::system_error(static_cast<int>(GetLastError()), std::system_category(), "fixture-client-open");
    check(recap::samePath(proof::imagePath(candidate.get()), expected), "fixture child image differs");
    child.process = std::move(candidate);
    check(child.primaryThread.close() == ERROR_SUCCESS, "previous primary thread handle could not close");
    child.pid = pid;
    child.primaryTid = 0;
    child.cleanup = {};
    child.stopCalls = 0;
}

std::string read(const fs::path& path) {
    std::ifstream input(path, std::ios::binary);
    check(static_cast<bool>(input), "fixture input is missing");
    return { std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>() };
}

enum class FixtureRecordKind { observed, sentinel };

DWORD parseFixturePid(std::string_view text, size_t recordBytes) {
    if (text.empty() || (text.size() > 1 && text.front() == '0'))
        throw FixtureRecordFailure("fixture-pid-syntax", recordBytes);
    uint64_t value = 0;
    for (const auto digit : text) {
        if (digit < '0' || digit > '9') throw FixtureRecordFailure("fixture-pid-syntax", recordBytes);
        const auto number = static_cast<uint64_t>(digit - '0');
        if (value > (static_cast<uint64_t>(MAXDWORD) - number) / 10)
            throw FixtureRecordFailure("fixture-pid-range", recordBytes);
        value = value * 10 + number;
    }
    if (!value) throw FixtureRecordFailure("fixture-pid-range", recordBytes);
    return static_cast<DWORD>(value);
}

DWORD parseFixtureRecord(const std::string& text, FixtureRecordKind kind) {
    if (text.empty()) throw FixtureRecordFailure("fixture-record-empty", 0);
    if (text.size() > 256) throw FixtureRecordFailure("fixture-record-oversize", text.size());
    if (kind == FixtureRecordKind::sentinel) return parseFixturePid(text, text.size());
    std::array<std::string_view, 4> fields;
    size_t start = 0;
    for (size_t index = 0; index < 3; ++index) {
        const auto end = text.find('\n', start);
        if (end == std::string::npos) throw FixtureRecordFailure("fixture-observed-shape", text.size());
        fields[index] = std::string_view(text).substr(start, end - start);
        start = end + 1;
    }
    fields[3] = std::string_view(text).substr(start);
    if (fields[3].find('\n') != std::string_view::npos || fields[0].substr(0, 4) != "pid=")
        throw FixtureRecordFailure("fixture-observed-shape", text.size());
    const auto pid = parseFixturePid(fields[0].substr(4), text.size());
    constexpr const char* prefixes[]{ "arguments=", "environment=", "cwd=" };
    constexpr const char* falseCodes[]{ "fixture-arguments-false", "fixture-environment-false", "fixture-cwd-false" };
    constexpr const char* malformedCodes[]{ "fixture-arguments-malformed", "fixture-environment-malformed", "fixture-cwd-malformed" };
    for (size_t index = 0; index < 3; ++index) {
        const std::string_view prefix(prefixes[index]);
        if (fields[index + 1].substr(0, prefix.size()) != prefix)
            throw FixtureRecordFailure("fixture-observed-shape", text.size());
        const auto flag = fields[index + 1].substr(prefix.size());
        if (flag == "false") throw FixtureRecordFailure(falseCodes[index], text.size());
        if (flag != "true") throw FixtureRecordFailure(malformedCodes[index], text.size());
    }
    return pid;
}

std::string readFixtureRecord(const fs::path& path, FixtureSetupContext& context) {
    const auto bytes = fs::file_size(path);
    context.recordBytes = static_cast<size_t>(bytes);
    if (!bytes) throw FixtureRecordFailure("fixture-record-empty", 0);
    if (bytes > 256) throw FixtureRecordFailure("fixture-record-oversize", context.recordBytes);
    std::ifstream input;
    input.exceptions(std::ios::badbit | std::ios::failbit);
    input.open(path, std::ios::binary);
    std::string text(static_cast<size_t>(bytes), '\0');
    input.read(text.data(), static_cast<std::streamsize>(bytes));
    if (input.peek() != std::char_traits<char>::eof())
        throw FixtureRecordFailure("fixture-record-size-changed", text.size());
    return text;
}

void fixtureRecordCases() {
    const std::string valid = "pid=123\narguments=true\nenvironment=true\ncwd=true";
    size_t cases = 0;
    const auto expect = [&](bool value, const char* message) {
        ++cases;
        if (!value && liveReport) { *liveReport << "DIAG fixture-record-case-failed index=" << cases << "\n"; liveReport->flush(); }
        check(value, message);
    };
    expect(parseFixtureRecord(valid, FixtureRecordKind::observed) == 123, "valid observed record was rejected");
    expect(parseFixtureRecord("123", FixtureRecordKind::sentinel) == 123, "valid sentinel record was rejected");
    expect(parseFixtureRecord("4294967295", FixtureRecordKind::sentinel) == MAXDWORD, "maximum DWORD PID was rejected");
    struct Invalid { std::string text; FixtureRecordKind kind; const char* code; };
    const std::array<Invalid, 13> invalid{{
        { "", FixtureRecordKind::observed, "fixture-record-empty" },
        { "pid=123", FixtureRecordKind::observed, "fixture-observed-shape" },
        { "pid=123\nenvironment=true\narguments=true\ncwd=true", FixtureRecordKind::observed, "fixture-observed-shape" },
        { "12x", FixtureRecordKind::sentinel, "fixture-pid-syntax" },
        { "0", FixtureRecordKind::sentinel, "fixture-pid-range" },
        { "4294967296", FixtureRecordKind::sentinel, "fixture-pid-range" },
        { "0123", FixtureRecordKind::sentinel, "fixture-pid-syntax" },
        { "pid=123\narguments=false\nenvironment=true\ncwd=true", FixtureRecordKind::observed, "fixture-arguments-false" },
        { "pid=123\narguments=true\nenvironment=false\ncwd=true", FixtureRecordKind::observed, "fixture-environment-false" },
        { "pid=123\narguments=true\nenvironment=true\ncwd=false", FixtureRecordKind::observed, "fixture-cwd-false" },
        { "pid=123\narguments=TRUE\nenvironment=true\ncwd=true", FixtureRecordKind::observed, "fixture-arguments-malformed" },
        { valid + "\n", FixtureRecordKind::observed, "fixture-observed-shape" },
        { std::string(257, '1'), FixtureRecordKind::sentinel, "fixture-record-oversize" }
    }};
    for (const auto& item : invalid) {
        bool rejected = false;
        try { parseFixtureRecord(item.text, item.kind); }
        catch (const FixtureRecordFailure& error) {
            rejected = std::string_view(error.code) == item.code && error.bytes == item.text.size();
        }
        expect(rejected, "malformed completed fixture record was not rejected precisely");
    }
    FixtureSetupContext context{ "inert-record-case" };
    context.recordReady = true;
    bool nativeRecord = false;
    try {
        fixtureSetup("fixture-simulated-record-parse", context, [&] {
            context.coordinator = parseFixtureRecord("", FixtureRecordKind::observed);
            context.clientRetained = true;
        });
    } catch (const FixtureSetupFailure& error) {
        nativeRecord = std::string_view(error.code) == "fixture-record-empty" &&
            std::string_view(error.stage) == "fixture-simulated-record-parse" &&
            std::string_view(error.category) == "record" && !context.clientRetained && context.coordinator == 0;
    }
    expect(nativeRecord, "record failure lost its setup stage or reached PID retention");
    bool fileContext = false;
    try {
        fixtureSetup("fixture-simulated-file-read", context, [] {
            throw fs::filesystem_error("inert", std::make_error_code(std::errc::permission_denied));
        });
    } catch (const FixtureSetupFailure& error) {
        fileContext = std::string_view(error.code) == "fixture-setup-filesystem-error" &&
            std::string_view(error.stage) == "fixture-simulated-file-read" &&
            error.numeric == std::make_error_code(std::errc::permission_denied).value();
    }
    expect(fileContext, "filesystem setup context lost its genuine code");
    check(cases == 18 && liveReport, "fixture record case count or report differs");
    *liveReport << "DIAG fixture-record-cases cases=18 passed=18 max_bytes=256 no_bad_record_retry=1\n";
    liveReport->flush();
}

bool verifyFixedFixture(const fs::path& path) {
    checkpoint("ENTER", "fixed-fixture-contract");
    check(fs::file_size(path) <= 16384, "fixed fixture source exceeds its bound");
    const auto input = read(path);
    std::string canonical;
    for (size_t index = 0; index < input.size(); ++index) {
        if (input[index] == '\r' && index + 1 < input.size() && input[index + 1] == '\n') continue;
        canonical.push_back(input[index]);
    }
    HCRYPTPROV provider = 0;
    HCRYPTHASH hash = 0;
    std::array<BYTE, 32> bytes{};
    DWORD length = static_cast<DWORD>(bytes.size());
    const bool hashed = CryptAcquireContextW(&provider, nullptr, MS_ENH_RSA_AES_PROV_W, PROV_RSA_AES, CRYPT_VERIFYCONTEXT) &&
        CryptCreateHash(provider, CALG_SHA_256, 0, 0, &hash) &&
        CryptHashData(hash, reinterpret_cast<const BYTE*>(canonical.data()), static_cast<DWORD>(canonical.size()), 0) &&
        CryptGetHashParam(hash, HP_HASHVAL, bytes.data(), &length, 0);
    const DWORD error = hashed ? ERROR_SUCCESS : GetLastError();
    const bool hashClosed = !hash || CryptDestroyHash(hash);
    const bool providerClosed = !provider || CryptReleaseContext(provider, 0);
    if (liveReport) {
        *liveReport << "DIAG fixture-digest hashed=" << hashed << " error=" << error
                    << " hash_closed=" << hashClosed << " provider_closed=" << providerClosed << "\n";
        liveReport->flush();
    }
    check(hashed && length == bytes.size() && hashClosed && providerClosed, "fixed fixture digest could not be verified");
    constexpr char hex[] = "0123456789abcdef";
    std::string digest;
    for (const auto value : bytes) { digest.push_back(hex[value >> 4]); digest.push_back(hex[value & 15]); }
    check(canonical.size() == 3005 &&
          digest == "300a0d2d3b1c195bddea2ccca076658f82ce1db6249b9cb5ec2d15163d8fc01d",
          "native closed profile requires the exact reviewed inert fixture");
    checkpoint("EXIT", "fixed-fixture-contract");
    return true;
}

void write(const fs::path& path, const std::string& text) {
    std::ofstream output(path, std::ios::binary);
    output << text;
    check(static_cast<bool>(output), "fixture output could not be written");
}

std::string readSemanticRecord(const fs::path& path) {
    const auto bytes = fs::file_size(path);
    check(bytes && bytes <= proof::SemanticRecordLimit, "semantic record byte bound differs");
    std::ifstream input;
    input.exceptions(std::ios::badbit | std::ios::failbit);
    input.open(path, std::ios::binary);
    std::string text(static_cast<size_t>(bytes), '\0');
    input.read(text.data(), static_cast<std::streamsize>(bytes));
    check(input.peek() == std::char_traits<char>::eof() && text.find('\0') == std::string::npos &&
          text.find('\r') == std::string::npos, "semantic record changed or has invalid controls");
    return text;
}

std::wstring semanticWide(const std::string& text) {
    if (text.empty()) return {};
    check(text.size() <= proof::SemanticRecordLimit, "semantic text byte bound differs");
    const auto size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0);
    check(size > 0, "semantic text is not UTF-8");
    std::wstring result(static_cast<size_t>(size), L'\0');
    check(MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()),
                             result.data(), size) == size, "semantic text decoding failed");
    return result;
}

void publishSemanticRecord(const fs::path& path, const std::string& text) {
    auto temporary = path;
    temporary += L".tmp";
    check(!fs::exists(path) && !fs::exists(temporary) && text.size() <= proof::SemanticRecordLimit,
          "semantic publication target or size differs");
    {
        std::ofstream output;
        output.exceptions(std::ios::badbit | std::ios::failbit);
        output.open(temporary, std::ios::binary);
        output.write(text.data(), static_cast<std::streamsize>(text.size()));
        output.close();
    }
    fs::rename(temporary, path);
}

void bindSemanticCaller(proof::Observer& observer, const fs::path& root, const std::wstring& mode) {
    const auto text = readSemanticRecord(root / L"semantic-caller.txt");
    std::vector<std::string> fields;
    size_t offset = 0;
    for (;;) {
        const auto end = text.find('\n', offset);
        if (end == std::string::npos) break;
        fields.push_back(text.substr(offset, end - offset));
        offset = end + 1;
    }
    check(offset == text.size() && fields.size() == 8 && fields[0] == "RCPSEM1" &&
          semanticWide(fields[5]) == mode && (fields[7] == "package" || fields[7] == "bundle"),
          "semantic caller record shape differs");
#if defined(_M_ARM64)
    check(fields[6] == "arm64", "semantic caller architecture differs");
#else
    check(fields[6] == "x64", "semantic caller architecture differs");
#endif
    observer.bindSemanticCaller(parseFixturePid(fields[1], text.size()), semanticWide(fields[2]),
        semanticWide(fields[3]), semanticWide(fields[4]), mode, semanticWide(fields[6]), semanticWide(fields[7]));
}

void collectSemanticOperations(proof::Observer& observer, const fs::path& root, size_t& ordinal, bool& active) {
    if (!active) {
        const auto begin = root / (L"semantic-begin-" + std::to_wstring(ordinal) + L".txt");
        if (!fs::exists(begin)) return;
        const auto text = readSemanticRecord(begin);
        const auto separator = text.find('\n');
        check(separator != std::string::npos && text.find('\n', separator + 1) == std::string::npos,
              "semantic begin record shape differs");
        observer.beginSemanticOperation(ordinal, text.substr(0, separator), semanticWide(text.substr(separator + 1)));
        publishSemanticRecord(root / (L"semantic-begin-" + std::to_wstring(ordinal) + L".ack"), std::to_string(ordinal));
        active = true;
    }
    const auto end = root / (L"semantic-end-" + std::to_wstring(ordinal) + L".txt");
    if (!fs::exists(end)) return;
    const auto text = readSemanticRecord(end);
    check(text == "ok" || text == "failed", "semantic end record shape differs");
    observer.endSemanticOperation(ordinal, text == "ok");
    publishSemanticRecord(root / (L"semantic-end-" + std::to_wstring(ordinal) + L".ack"), std::to_string(ordinal));
    active = false;
    ++ordinal;
}

HWND windowFor(DWORD pid) {
    struct Search { DWORD pid; HWND found; } search{ pid, nullptr };
    EnumWindows([](HWND window, LPARAM value) -> BOOL {
        auto& state = *reinterpret_cast<Search*>(value);
        DWORD owner = 0;
        GetWindowThreadProcessId(window, &owner);
        wchar_t name[128]{};
        GetClassNameW(window, name, static_cast<int>(std::size(name)));
        if (owner == state.pid && wcscmp(name, L"RecapPageStartupWindow") == 0) state.found = window;
        return TRUE;
    }, reinterpret_cast<LPARAM>(&search));
    return search.found;
}

std::wstring controlText(HWND control) {
    check(control != nullptr, "native control is missing");
    const auto length = static_cast<size_t>(sendChecked(control, WM_GETTEXTLENGTH));
    check(length < 256 * 1024, "native text exceeded its display bound");
    std::vector<wchar_t> buffer(length + 1);
    sendChecked(control, WM_GETTEXT, buffer.size(), reinterpret_cast<LPARAM>(buffer.data()));
    return { buffer.data() };
}

void responsive(HWND window) {
    sendChecked(window, WM_NULL);
}

bool sameKernelObject(HANDLE first, HANDLE second) {
    // SDK 26100 declares the API but the hosted image has no kernelbase.lib.
    const auto module = GetModuleHandleW(L"kernelbase.dll");
    check(module != nullptr, "kernel object comparison is unavailable");
    const auto address = GetProcAddress(module, "CompareObjectHandles");
    check(address != nullptr, "kernel object comparison is unavailable");
    decltype(&CompareObjectHandles) compare = nullptr;
    static_assert(sizeof(compare) == sizeof(address));
    memcpy(&compare, &address, sizeof(compare));
    return compare(first, second) != FALSE;
}

enum class HandleVerdict { excluded, calibratedEventExcluded, inherited, inconclusive };

struct EventExclusionControl {
    bool retainedEvent = false, guiEqual = false, originalRecorded = false;
    bool remoteCreated = false, differentSlot = false, returnedEqual = false;
    bool cleaned = false, finalIdentityAndLifetime = false;
    bool valid() const {
        return retainedEvent && guiEqual && originalRecorded && remoteCreated &&
            differentSlot && returnedEqual && cleaned && finalIdentityAndLifetime;
    }
};

bool eventExcluded(HandleVerdict value) {
    return value == HandleVerdict::excluded || value == HandleVerdict::calibratedEventExcluded;
}

const char* verdictName(HandleVerdict value) {
    return value == HandleVerdict::excluded ? "excluded"
        : value == HandleVerdict::calibratedEventExcluded ? "excluded-event-under-calibrated-control"
        : value == HandleVerdict::inherited ? "inherited" : "inconclusive";
}

HandleVerdict classifyHandle(bool duplicated, DWORD error, bool comparisonKnown, bool equal,
                            bool controlAndLifetime, const EventExclusionControl& eventControl = {}) {
    if (!controlAndLifetime) return HandleVerdict::inconclusive;
    if (duplicated && comparisonKnown) return equal ? HandleVerdict::inherited : HandleVerdict::excluded;
    if (!duplicated && error == ERROR_INVALID_HANDLE) return HandleVerdict::excluded;
    if (!duplicated && error == ERROR_NOT_SUPPORTED && eventControl.valid())
        return HandleVerdict::calibratedEventExcluded;
    return HandleVerdict::inconclusive;
}

void handleClassificationCases() {
    check(classifyHandle(true, 0, true, false, true) == HandleVerdict::excluded, "unequal valid handle did not establish exclusion");
    check(classifyHandle(true, 0, true, true, true) == HandleVerdict::inherited, "equal sentinel was not rejected");
    check(classifyHandle(false, ERROR_INVALID_HANDLE, false, false, true) == HandleVerdict::excluded, "controlled invalid handle did not establish exclusion");
    check(classifyHandle(false, ERROR_ACCESS_DENIED, false, false, true) == HandleVerdict::inconclusive, "unknown denial became successful exclusion");
    check(classifyHandle(false, 0, false, false, true) == HandleVerdict::inconclusive, "missing error became successful exclusion");
    check(classifyHandle(false, ERROR_INVALID_HANDLE, false, false, false) == HandleVerdict::inconclusive, "unvalidated control became successful exclusion");
    const EventExclusionControl complete{ true, true, true, true, true, true, true, true };
    check(classifyHandle(false, ERROR_NOT_SUPPORTED, false, false, true, complete) == HandleVerdict::calibratedEventExcluded,
          "complete current event control did not qualify event exclusion");
    for (const auto member : {
        &EventExclusionControl::retainedEvent, &EventExclusionControl::guiEqual,
        &EventExclusionControl::originalRecorded, &EventExclusionControl::remoteCreated,
        &EventExclusionControl::differentSlot, &EventExclusionControl::returnedEqual,
        &EventExclusionControl::cleaned, &EventExclusionControl::finalIdentityAndLifetime
    }) {
        auto missing = complete;
        missing.*member = false;
        check(classifyHandle(false, ERROR_NOT_SUPPORTED, false, false, true, missing) == HandleVerdict::inconclusive,
              "incomplete event control became successful exclusion");
    }
    check(classifyHandle(false, ERROR_NOT_SUPPORTED, false, false, false, complete) == HandleVerdict::inconclusive,
          "stale original observation was accepted with a later control");
    check(classifyHandle(false, ERROR_ACCESS_DENIED, false, false, true, complete) == HandleVerdict::inconclusive,
          "event control incorrectly accepted access denial");
    check(classifyHandle(true, 0, false, false, true, complete) == HandleVerdict::inconclusive,
          "event control incorrectly accepted unknown comparison");
    check(classifyHandle(true, 0, true, true, true, complete) == HandleVerdict::inherited,
          "event control incorrectly accepted inherited identity");
}

struct DuplicationFact {
    BOOL result = FALSE;
    DWORD error = 0;
    HANDLE handle = nullptr;
};

DuplicationFact duplicateFact(HANDLE sourceProcess, HANDLE source, HANDLE targetProcess, DWORD options) {
    checkpoint("ENTER", "handle-duplicate");
    DuplicationFact fact;
    SetLastError(ERROR_SUCCESS);
    fact.result = DuplicateHandle(sourceProcess, source, targetProcess, &fact.handle, 0, FALSE, options);
    fact.error = GetLastError();
    checkpoint("EXIT", "handle-duplicate");
    return fact;
}

struct ComparisonFact {
    bool known = false, equal = false;
    DWORD error = 0;
};

ComparisonFact compareFact(HANDLE original, HANDLE copy) {
    checkpoint("ENTER", "handle-compare");
    ComparisonFact fact;
    DWORD originalFlags = 0, copyFlags = 0;
    if (!GetHandleInformation(original, &originalFlags) || !GetHandleInformation(copy, &copyFlags)) {
        fact.error = GetLastError();
        checkpoint("FAIL", "handle-compare");
        return fact;
    }
    SetLastError(ERROR_SUCCESS);
    fact.equal = sameKernelObject(original, copy);
    fact.error = GetLastError();
    fact.known = fact.equal || fact.error == ERROR_SUCCESS || fact.error == ERROR_NOT_SAME_OBJECT;
    checkpoint("EXIT", "handle-compare");
    return fact;
}

uint64_t creationTime(HANDLE process);

HandleVerdict observeSentinel(Child& gui, Child& coordinator, HANDLE sentinel, std::ofstream& report,
                              bool diagnostic) {
    const auto self = GetCurrentProcess();
    const DWORD requestedRights = SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | PROCESS_DUP_HANDLE;
    DWORD flags = 0;
    SetLastError(ERROR_SUCCESS);
    const BOOL flagsResult = GetHandleInformation(sentinel, &flags);
    const DWORD flagsError = GetLastError();
    const auto guiCreation = creationTime(gui.process.get()), coordinatorCreation = creationTime(coordinator.process.get());
    const DWORD guiBefore = WaitForSingleObject(gui.process.get(), 0);
    const DWORD guiWaitError = guiBefore == WAIT_FAILED ? GetLastError() : 0;
    const DWORD coordinatorBefore = WaitForSingleObject(coordinator.process.get(), 0);
    const DWORD coordinatorWaitError = coordinatorBefore == WAIT_FAILED ? GetLastError() : 0;
    report << "HANDLE setup observer_pid=" << GetCurrentProcessId() << " gui_pid=" << gui.pid
           << " coordinator_pid=" << coordinator.pid << " gui_creation=" << guiCreation
           << " coordinator_creation=" << coordinatorCreation << " coordinator_requested_rights=" << requestedRights
           << " gui_rights=create-process-full-access"
           << " slot=" << reinterpret_cast<uintptr_t>(sentinel)
           << " sentinel_flags_result=" << flagsResult << " sentinel_flags=" << flags
           << " sentinel_flags_error=" << flagsError << " gui_wait_before=" << guiBefore
           << " gui_wait_error=" << guiWaitError << " coordinator_wait_before=" << coordinatorBefore
           << " coordinator_wait_error=" << coordinatorWaitError << "\n";

    const auto guiDuplicate = duplicateFact(gui.process.get(), sentinel, self, DUPLICATE_SAME_ACCESS);
    recap::Handle guiCopy(guiDuplicate.result ? guiDuplicate.handle : nullptr);
    const auto guiComparison = guiCopy ? compareFact(sentinel, guiCopy.get()) : ComparisonFact{};
    const bool guiControl = flagsResult && (flags & HANDLE_FLAG_INHERIT) &&
        guiDuplicate.result && guiComparison.known && guiComparison.equal;
    report << "HANDLE gui-control duplicate_result=" << guiDuplicate.result << " error=" << guiDuplicate.error
           << " copy=" << reinterpret_cast<uintptr_t>(guiDuplicate.handle)
           << " comparison_known=" << guiComparison.known << " equal=" << guiComparison.equal
           << " comparison_error=" << guiComparison.error << " valid=" << guiControl << "\n";

    const auto original = duplicateFact(coordinator.process.get(), sentinel, self, DUPLICATE_SAME_ACCESS);
    recap::Handle originalCopy(original.result ? original.handle : nullptr);
    const auto comparison = originalCopy ? compareFact(sentinel, originalCopy.get()) : ComparisonFact{};
    const DWORD guiAfter = WaitForSingleObject(gui.process.get(), 0);
    const DWORD guiAfterError = guiAfter == WAIT_FAILED ? GetLastError() : 0;
    const DWORD coordinatorAfter = WaitForSingleObject(coordinator.process.get(), 0);
    const DWORD coordinatorAfterError = coordinatorAfter == WAIT_FAILED ? GetLastError() : 0;
    const bool identity = GetProcessId(gui.process.get()) == gui.pid &&
        GetProcessId(coordinator.process.get()) == coordinator.pid &&
        creationTime(gui.process.get()) == guiCreation && creationTime(coordinator.process.get()) == coordinatorCreation;
    const bool live = guiBefore == WAIT_TIMEOUT && coordinatorBefore == WAIT_TIMEOUT &&
        guiAfter == WAIT_TIMEOUT && coordinatorAfter == WAIT_TIMEOUT;
    auto verdict = classifyHandle(original.result != FALSE, original.error, comparison.known,
                                   comparison.equal, guiControl && live && identity);
    report << "HANDLE original-slot duplicate_result=" << original.result << " error=" << original.error
           << " copy=" << reinterpret_cast<uintptr_t>(original.handle)
           << " comparison_known=" << comparison.known << " equal=" << comparison.equal
           << " comparison_error=" << comparison.error << " gui_wait_after=" << guiAfter
           << " gui_wait_error=" << guiAfterError << " coordinator_wait_after=" << coordinatorAfter
           << " coordinator_wait_error=" << coordinatorAfterError
           << " identity=" << identity << " live=" << live << " verdict=" << verdictName(verdict) << "\n";
    report.flush();
    check(static_cast<bool>(report), "original handle observation could not be retained");

    if ((diagnostic || original.error == ERROR_NOT_SUPPORTED) &&
        verdict == HandleVerdict::inconclusive && live && identity) {
        EventExclusionControl control;
        control.retainedEvent = flagsResult && (flags & HANDLE_FLAG_INHERIT);
        control.guiEqual = guiControl;
        control.originalRecorded = true;
        const auto remote = duplicateFact(self, sentinel, coordinator.process.get(), DUPLICATE_SAME_ACCESS);
        control.remoteCreated = remote.result != FALSE;
        control.differentSlot = remote.result && remote.handle != sentinel;
        report << "HANDLE coordinator-control-create duplicate_result=" << remote.result << " error=" << remote.error
               << " remote_slot=" << reinterpret_cast<uintptr_t>(remote.handle)
               << " reuses_original_slot=" << (remote.handle == sentinel) << " phase=after-original-observation\n";
        if (remote.result) {
            const auto returned = duplicateFact(coordinator.process.get(), remote.handle, self, DUPLICATE_SAME_ACCESS);
            recap::Handle local(returned.result ? returned.handle : nullptr);
            const auto same = local ? compareFact(sentinel, local.get()) : ComparisonFact{};
            control.returnedEqual = returned.result && same.known && same.equal;
            report << "HANDLE coordinator-control-return duplicate_result=" << returned.result
                   << " error=" << returned.error << " comparison_known=" << same.known
                   << " equal=" << same.equal << " comparison_error=" << same.error << "\n";
            const auto closed = duplicateFact(coordinator.process.get(), remote.handle, self,
                                               DUPLICATE_SAME_ACCESS | DUPLICATE_CLOSE_SOURCE);
            recap::Handle closingCopy(closed.result ? closed.handle : nullptr);
            const auto closingComparison = closingCopy ? compareFact(sentinel, closingCopy.get()) : ComparisonFact{};
            control.cleaned = closed.result && closingComparison.known && closingComparison.equal;
            report << "HANDLE coordinator-control-close duplicate_result=" << closed.result << " error=" << closed.error
                   << " comparison_known=" << closingComparison.known << " equal=" << closingComparison.equal
                   << " closed_only_test_created_remote_handle=1\n";
            report.flush();
            check(control.cleaned, "test-created remote sentinel cleanup could not be confirmed");
        }
        const DWORD finalGuiWait = WaitForSingleObject(gui.process.get(), 0);
        const DWORD finalGuiError = finalGuiWait == WAIT_FAILED ? GetLastError() : 0;
        const DWORD finalCoordinatorWait = WaitForSingleObject(coordinator.process.get(), 0);
        const DWORD finalCoordinatorError = finalCoordinatorWait == WAIT_FAILED ? GetLastError() : 0;
        DWORD finalFlags = 0;
        const BOOL retained = GetHandleInformation(sentinel, &finalFlags);
        control.finalIdentityAndLifetime = finalGuiWait == WAIT_TIMEOUT && finalCoordinatorWait == WAIT_TIMEOUT &&
            retained && (finalFlags & HANDLE_FLAG_INHERIT) &&
            GetProcessId(gui.process.get()) == gui.pid && GetProcessId(coordinator.process.get()) == coordinator.pid &&
            creationTime(gui.process.get()) == guiCreation && creationTime(coordinator.process.get()) == coordinatorCreation;
        verdict = classifyHandle(original.result != FALSE, original.error, comparison.known,
                                 comparison.equal, guiControl && live && identity, control);
        report << "HANDLE event-specific-control original_error=" << original.error
               << " different_slot=" << control.differentSlot << " returned_equal=" << control.returnedEqual
               << " cleaned=" << control.cleaned << " final_identity_live=" << control.finalIdentityAndLifetime
               << " final_gui_wait=" << finalGuiWait << " final_gui_error=" << finalGuiError
               << " final_coordinator_wait=" << finalCoordinatorWait << " final_coordinator_error=" << finalCoordinatorError
               << " verdict=" << verdictName(verdict) << " slot_type=not-inferred\n";
        report.flush();
    }
    return verdict;
}

template<class T> struct Com {
    T* value = nullptr;
    Com() = default;
    Com(const Com&) = delete;
    Com& operator=(const Com&) = delete;
    ~Com() {
        if (value) {
            checkpoint("ENTER", "com-release");
            value->Release();
            checkpoint("EXIT", "com-release");
        }
    }
    T** put() { return &value; }
    T* operator->() { return value; }
};

enum class UiaOutput { available, optionalAbsent, invalid };

UiaOutput classifyUiaOutput(HRESULT result, bool present, bool optional) {
    if (FAILED(result)) return UiaOutput::invalid;
    if (present) return UiaOutput::available;
    return optional ? UiaOutput::optionalAbsent : UiaOutput::invalid;
}

bool checkedUiaOutput(const char* stage, HRESULT result, const void* pointer, bool optional = false) {
    if (liveReport) {
        *liveReport << "CHECK INFO " << stage << " hresult=" << result
                    << " pointer_present=" << (pointer != nullptr) << "\n";
        liveReport->flush();
    }
    const auto state = classifyUiaOutput(result, pointer != nullptr, optional);
    check(state != UiaOutput::invalid, "required UI Automation output was unavailable");
    return state == UiaOutput::available;
}

void uiaOutputCases() {
    check(classifyUiaOutput(S_OK, false, false) == UiaOutput::invalid, "required successful-null UIA output was accepted");
    check(classifyUiaOutput(E_FAIL, true, false) == UiaOutput::invalid, "failed nonnull UIA output was accepted");
    check(classifyUiaOutput(S_OK, false, true) == UiaOutput::optionalAbsent, "optional pattern absence was misclassified");
}

void automationClient(Com<IUIAutomation2>& automation) {
    const auto result = observed("uia-create", [&] {
        return CoCreateInstance(CLSID_CUIAutomation8, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(automation.put()));
    });
    checkedUiaOutput("uia-client-output", result, automation.value);
    check(SUCCEEDED(observed("uia-connection-timeout", [&] { return automation->put_ConnectionTimeout(2000); })),
          "UI Automation connection timeout unavailable");
    check(SUCCEEDED(observed("uia-transaction-timeout", [&] { return automation->put_TransactionTimeout(2000); })),
          "UI Automation transaction timeout unavailable");
}

void accessible(HWND window, bool failed) {
    responsive(window);
    Com<IUIAutomation2> automation;
    automationClient(automation);
    for (const auto& item : std::vector<std::pair<int, std::wstring>>{
        {201, L"RECAP PAGE!"}, {203, failed ? L"Close" : L"Hide startup window"}
    }) {
        Com<IUIAutomationElement> element;
        const auto elementResult = observed("uia-element", [&] { return automation->ElementFromHandle(GetDlgItem(window, item.first), element.put()); });
        checkedUiaOutput("uia-element-output", elementResult, element.value);
        struct NameValue { BSTR value = nullptr; ~NameValue() { SysFreeString(value); } } name;
        const auto nameResult = observed("uia-name", [&] { return element->get_CurrentName(&name.value); });
        checkedUiaOutput("uia-name-output", nameResult, name.value);
        const std::wstring actual(name.value);
        check(actual == item.second, "native accessible name differed");
        CONTROLTYPEID type = 0;
        check(SUCCEEDED(observed("uia-role", [&] { return element->get_CurrentControlType(&type); })), "native accessible role unavailable");
        check(type == (item.first == 203 ? UIA_ButtonControlTypeId : UIA_TextControlTypeId),
              "native accessible role differed");
    }
    if (failed) {
        Com<IUIAutomationElement> element;
        const auto elementResult = observed("uia-error-element", [&] { return automation->ElementFromHandle(GetDlgItem(window, 204), element.put()); });
        checkedUiaOutput("uia-error-element-output", elementResult, element.value);
        Com<IUIAutomationValuePattern> value;
        const auto valueResult = observed("uia-value-pattern", [&] { return element->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(value.put())); });
        checkedUiaOutput("uia-value-output", valueResult, value.value);
        BOOL readonly = FALSE;
        check(SUCCEEDED(observed("uia-readonly", [&] { return value->get_CurrentIsReadOnly(&readonly); })) && readonly, "error text is not read-only");
        Com<IUIAutomationTextPattern> text;
        const auto textResult = observed("uia-text-pattern", [&] { return element->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(text.put())); });
        checkedUiaOutput("uia-text-output", textResult, text.value);
        Com<IUIAutomationTextRange> range;
        const auto rangeResult = observed("uia-document-range", [&] { return text->get_DocumentRange(range.put()); });
        checkedUiaOutput("uia-range-output", rangeResult, range.value);
        check(SUCCEEDED(observed("uia-select-text", [&] { return range->Select(); })), "error text selection failed");
    }
}

void bounds(HWND window) {
    checkpoint("ENTER", "control-bounds");
    RECT parent{};
    GetClientRect(window, &parent);
    POINT origin{ 0, 0 };
    ClientToScreen(window, &origin);
    for (const int id : { 201, 202, 203, 205 }) {
        RECT child{};
        check(GetWindowRect(GetDlgItem(window, id), &child) != FALSE, "control bounds unavailable");
        check(child.left >= origin.x && child.top >= origin.y &&
              child.right <= origin.x + parent.right && child.bottom <= origin.y + parent.bottom,
              "native control clipped outside window");
    }
    checkpoint("EXIT", "control-bounds");
}

struct RenderEvidence {
    UINT dpi = 0;
    LONG width = 0, height = 0;
    uint64_t fill = 0, outline = 0, shadow = 0;
    bool unclipped = true;
    LONG iconTop = 0, iconBottom = 0;
    bool centered = false;
    RECT footer{};
    uint64_t footerInk = 0;
    bool footerVerified = false;
};

COLORREF capture(HWND window, const fs::path& destination, RenderEvidence* evidence = nullptr) {
    check(window && IsWindow(window), "owned capture window is missing");
    RECT rect{};
    check(GetClientRect(window, &rect) != FALSE, "owned client dimensions unavailable");
    check(rect.right > 0 && rect.bottom > 0 &&
          static_cast<uint64_t>(rect.right) * static_cast<uint64_t>(rect.bottom) * 4 + 54 <= 4 * 1024 * 1024,
          "owned client capture exceeds its image bound");
    if (evidence) {
        observed("pending-footer-properties", [&] {
            const auto footer = GetDlgItem(window, 205);
            const bool text = footer && controlText(footer) == L"Closing this window lets startup continue in the background.";
            const bool visible = footer && IsWindowVisible(footer);
            bool bounds = footer && GetWindowRect(footer, &evidence->footer);
            if (bounds) {
                SetLastError(ERROR_SUCCESS);
                const auto moved = MapWindowPoints(nullptr, window, reinterpret_cast<POINT*>(&evidence->footer), 2);
                bounds = (moved || GetLastError() == ERROR_SUCCESS) && evidence->footer.left >= 0 &&
                    evidence->footer.top >= 0 && evidence->footer.right <= rect.right && evidence->footer.bottom <= rect.bottom &&
                    evidence->footer.right > evidence->footer.left && evidence->footer.bottom > evidence->footer.top;
            }
            if (liveReport) {
                *liveReport << "DIAG footer-properties text_match=" << text << " visible=" << visible << " bounds=" << bounds
                            << " left=" << evidence->footer.left << " top=" << evidence->footer.top
                            << " right=" << evidence->footer.right << " bottom=" << evidence->footer.bottom << "\n";
                liveReport->flush();
            }
            check(text, "pending footer text is missing or changed");
            check(visible && bounds, "pending footer is not visible within the client");
            evidence->footerVerified = true;
        });
    }
    check(observed("owned-client-settle", [&] {
        return RedrawWindow(window, nullptr, nullptr, RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN) != FALSE;
    }), "owned client repaint failed");
    const auto dc = GetDC(window), memory = CreateCompatibleDC(dc);
    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = rect.right;
    info.bmiHeader.biHeight = -rect.bottom;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    void* data = nullptr;
    const auto bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &data, nullptr, 0);
    check(bitmap && memory, "fixture window capture unavailable");
    const auto old = SelectObject(memory, bitmap);
    const bool printed = observed("print-window", [&] { return PrintWindow(window, memory, PW_CLIENTONLY) != FALSE; });
    check(printed, "fixture window capture failed");
    const auto color = GetPixel(memory, 10, 10);
    check(color != CLR_INVALID, "owned capture background unavailable");
    if (evidence) {
        checkpoint("ENTER", "wordmark-ink");
        RECT heading{};
        check(GetWindowRect(GetDlgItem(window, 201), &heading) != FALSE, "wordmark rectangle unavailable");
        SetLastError(ERROR_SUCCESS);
        const auto mapped = MapWindowPoints(nullptr, window, reinterpret_cast<POINT*>(&heading), 2);
        check(mapped != 0 || GetLastError() == ERROR_SUCCESS, "wordmark coordinates could not be mapped");
        check(heading.left >= 0 && heading.top >= 0 && heading.right <= rect.right && heading.bottom <= rect.bottom,
              "wordmark capture bounds are clipped");
        evidence->dpi = GetDpiForWindow(window);
        check(evidence->dpi != 0, "owned capture DPI unavailable");
        evidence->width = rect.right;
        evidence->height = rect.bottom;
        const auto* pixels = static_cast<const unsigned char*>(data);
        LONG iconTop = rect.bottom, iconBottom = -1;
        for (LONG y = 0; y < rect.bottom; ++y) {
            for (LONG x = 0; x < rect.right; ++x) {
                const auto offset = (static_cast<size_t>(y) * static_cast<size_t>(rect.right) + static_cast<size_t>(x)) * 4;
                if (RGB(pixels[offset + 2], pixels[offset + 1], pixels[offset]) == RGB(109, 40, 217)) {
                    iconTop = std::min(iconTop, y);
                    iconBottom = std::max(iconBottom, y);
                }
            }
        }
        check(iconBottom >= iconTop, "original icon fill was not captured");
        evidence->iconTop = iconTop;
        evidence->iconBottom = iconBottom;
        evidence->centered = std::abs(iconTop + iconBottom - (rect.bottom - 1)) <= 2;
        check(evidence->centered, "NI-001 pending icon row is not centered in the full client");
        for (LONG y = heading.top; y < heading.bottom; ++y) {
            for (LONG x = heading.left; x < heading.right; ++x) {
                const auto offset = (static_cast<size_t>(y) * static_cast<size_t>(rect.right) + static_cast<size_t>(x)) * 4;
                const auto pixel = RGB(pixels[offset + 2], pixels[offset + 1], pixels[offset]);
                const bool fill = pixel == RGB(127, 179, 255);
                const bool outline = pixel == RGB(255, 255, 255);
                const bool shadow = pixel == RGB(138, 83, 225);
                evidence->fill += fill ? 1 : 0;
                evidence->outline += outline ? 1 : 0;
                evidence->shadow += shadow ? 1 : 0;
                if ((fill || outline || shadow) &&
                    (x == heading.left || y == heading.top || x == heading.right - 1 || y == heading.bottom - 1))
                    evidence->unclipped = false;
            }
        }
        check(evidence->fill > 0 && evidence->outline > 0 && evidence->shadow > 0 && evidence->unclipped,
              "actual wordmark fill outline shadow or unclipped ink was not observed");
        checkpoint("EXIT", "wordmark-ink");
        checkpoint("ENTER", "pending-footer-ink");
        LONG left = rect.right, right = -1, top = rect.bottom, bottom = -1;
        for (LONG y = evidence->footer.top; y < evidence->footer.bottom; ++y) {
            for (LONG x = evidence->footer.left; x < evidence->footer.right; ++x) {
                const auto offset = (static_cast<size_t>(y) * static_cast<size_t>(rect.right) + static_cast<size_t>(x)) * 4;
                if (RGB(pixels[offset + 2], pixels[offset + 1], pixels[offset]) == color) continue;
                ++evidence->footerInk;
                left = std::min(left, x); right = std::max(right, x);
                top = std::min(top, y); bottom = std::max(bottom, y);
            }
        }
        if (liveReport) {
            *liveReport << "DIAG footer-capture ink_pixels=" << evidence->footerInk
                        << " ink_left=" << left << " ink_top=" << top << " ink_right=" << right << " ink_bottom=" << bottom << "\n";
            liveReport->flush();
        }
        check(evidence->footerInk >= 64 && right - left >= 16 && bottom - top >= 4,
              "pending footer text ink was not captured");
        checkpoint("EXIT", "pending-footer-ink");
    }
    const DWORD size = static_cast<DWORD>(rect.right * rect.bottom * 4);
    BITMAPFILEHEADER header{};
    header.bfType = 0x4d42;
    header.bfOffBits = sizeof(header) + sizeof(BITMAPINFOHEADER);
    header.bfSize = header.bfOffBits + size;
    std::ofstream output(destination, std::ios::binary);
    output.write(reinterpret_cast<const char*>(&header), sizeof(header));
    output.write(reinterpret_cast<const char*>(&info.bmiHeader), sizeof(info.bmiHeader));
    output.write(static_cast<const char*>(data), size);
    SelectObject(memory, old);
    DeleteObject(bitmap);
    DeleteDC(memory);
    ReleaseDC(window, dc);
    check(printed && static_cast<bool>(output), "fixture window capture failed");
    return color;
}

int CALLBACK declaredFontFound(const LOGFONTW*, const TEXTMETRICW*, DWORD, LPARAM found) {
    *reinterpret_cast<bool*>(found) = true;
    return 0;
}

void writeRenderEvidence(HWND window, const fs::path& root, const RenderEvidence& evidence, bool fontMetadata) {
    checkpoint("ENTER", "declared-font-availability");
    const std::array<const wchar_t*, 4> names{ L"Impact", L"Haettenschweiler", L"Arial Narrow Bold", L"Segoe UI" };
    std::array<bool, 4> available{};
    const auto dc = CreateCompatibleDC(nullptr);
    check(dc != nullptr, "local font availability DC unavailable");
    size_t first = names.size();
    for (size_t index = 0; index < names.size(); ++index) {
        LOGFONTW query{};
        query.lfCharSet = DEFAULT_CHARSET;
        lstrcpynW(query.lfFaceName, names[index], LF_FACESIZE);
        EnumFontFamiliesExW(dc, &query, declaredFontFound, reinterpret_cast<LPARAM>(&available[index]), 0);
        if (available[index] && first == names.size()) first = index;
    }
    DeleteDC(dc);
    check(first < names.size(), "none of the declared font candidates was available");
    const auto ascii = [](const wchar_t* value) {
        std::string text;
        for (; *value; ++value) text += static_cast<char>(*value);
        return text;
    };
    std::ofstream output(root / L"render-evidence.json", std::ios::binary);
    output << "{\"pendingOnly\":true,\"nameRoleVerified\":true,\"pendingControlsVerified\":true,"
           << "\"errorDetailsHidden\":true,\"wordmarkUnclipped\":true,\"width\":" << evidence.width
           << ",\"height\":" << evidence.height << ",\"dpi\":" << evidence.dpi
           << ",\"fillPixels\":" << evidence.fill << ",\"outlinePixels\":" << evidence.outline
           << ",\"shadowPixels\":" << evidence.shadow << ",\"fontPatternAvailable\":"
           << (fontMetadata ? "true" : "false") << ",\"renderedReviewRequired\":true,\"expectedFirstCandidate\":\""
           << ascii(names[first]) << "\",\"iconTop\":" << evidence.iconTop
           << ",\"iconBottom\":" << evidence.iconBottom << ",\"rowCentered\":true"
           << ",\"footerTextVerified\":" << (evidence.footerVerified ? "true" : "false")
           << ",\"footerVisible\":true,\"footerBoundsVerified\":true,\"footerInkPixels\":" << evidence.footerInk
           << ",\"footerLeft\":" << evidence.footer.left << ",\"footerTop\":" << evidence.footer.top
           << ",\"footerRight\":" << evidence.footer.right << ",\"footerBottom\":" << evidence.footer.bottom
           << ",\"fontAvailability\":[";
    for (size_t index = 0; index < names.size(); ++index)
        output << (index ? "," : "") << "{\"name\":\"" << ascii(names[index])
               << "\",\"available\":" << (available[index] ? "true" : "false") << "}";
    output << "]}";
    output.close();
    check(static_cast<bool>(output) && IsWindowVisible(window), "pending render evidence could not be retained");
    checkpoint("EXIT", "declared-font-availability");
}

void visualOperation(HWND window, const fs::path& root, std::ofstream& report) {
    checkpoint("ENTER", "visual-assertions");
    accessible(window, false);
    bounds(window);
    check(IsWindowVisible(window) && !IsWindowVisible(GetDlgItem(window, 204)) &&
          controlText(GetDlgItem(window, 202)) == L"Opening your reading tracker..." &&
          controlText(GetDlgItem(window, 203)) == L"Hide startup window",
          "safe pending-only capture identity did not hold");
    RenderEvidence rendering;
    check(capture(window, root / L"startup-dark.bmp", &rendering) == RGB(25, 25, 37), "ordinary startup surface is not dark");
    Com<IUIAutomation2> automation;
    automationClient(automation);
    Com<IUIAutomationElement> heading;
    const auto headingResult = observed("uia-font-element", [&] {
        return automation->ElementFromHandle(GetDlgItem(window, 201), heading.put());
    });
    checkedUiaOutput("uia-font-element-output", headingResult, heading.value);
    Com<IUIAutomationTextPattern> text;
    const auto patternResult = observed("uia-font-pattern", [&] {
        return heading->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(text.put()));
    });
    const bool fontMetadata = checkedUiaOutput("uia-optional-font-pattern-output", patternResult, text.value, true);
    report << "CHECK INFO " << (fontMetadata ? "font-pattern-available-rendered-review-required"
                                           : "font-metadata-unavailable-rendered-review-required") << "\n";
    report.flush();
    writeRenderEvidence(window, root, rendering, fontMetadata);
    HIGHCONTRASTW before{ sizeof(HIGHCONTRASTW), 0, nullptr };
    check(observed("high-contrast-read", [&] {
        return SystemParametersInfoW(SPI_GETHIGHCONTRAST, sizeof(before), &before, 0) != FALSE;
    }), "high contrast unavailable");
    auto high = before;
    high.dwFlags |= HCF_HIGHCONTRASTON;
    check(observed("high-contrast-enable", [&] {
        return SystemParametersInfoW(SPI_SETHIGHCONTRAST, sizeof(high), &high, 0) != FALSE;
    }),
          "high contrast could not be enabled");
    try {
        sendChecked(window, WM_SETTINGCHANGE);
        check(capture(window, root / L"startup-high-contrast.bmp") == GetSysColor(COLOR_WINDOW),
              "startup ignored high contrast");
        accessible(window, false);
    } catch (const std::exception& failure) {
        if (!SystemParametersInfoW(SPI_SETHIGHCONTRAST, sizeof(before), &before, 0))
            throw std::runtime_error(std::string(failure.what()) + "; high contrast restoration failed");
        throw;
    }
    check(observed("high-contrast-restore", [&] {
        return SystemParametersInfoW(SPI_SETHIGHCONTRAST, sizeof(before), &before, 0) != FALSE;
    }),
          "high contrast could not be restored");
    sendChecked(window, WM_SETTINGCHANGE);
    const auto originalDpi = GetDpiForWindow(window);
    RECT original{};
    GetWindowRect(window, &original);
    for (const UINT dpi : { 144u, 192u }) {
        RECT proposed{ original.left, original.top, original.left + MulDiv(640, dpi, 96),
                       original.top + MulDiv(340, dpi, 96) };
        static_assert(WM_DPICHANGED < WM_USER);
        // User32 marshals this system-message RECT; no foreign-process GDI handle is consumed.
        observed("synthetic-dpi-message", [&] {
            sendChecked(window, WM_DPICHANGED, MAKEWPARAM(dpi, dpi), reinterpret_cast<LPARAM>(&proposed));
        });
        bounds(window);
        responsive(window);
    }
    sendChecked(window, WM_DPICHANGED, MAKEWPARAM(originalDpi, originalDpi), reinterpret_cast<LPARAM>(&original));
    report << "dpi-message-cases=2;kind=emulated\n";
    checkpoint("EXIT", "visual-assertions");
}

void visual(HWND window, const fs::path& root, std::ofstream&, proof::Observer& observer) {
    checkpoint("ENTER", "visual-worker");
    DWORD owner = 0;
    check(GetWindowThreadProcessId(window, &owner) != 0 && owner != 0, "visual target ownership unavailable");
    HIGHCONTRASTW before{ sizeof(HIGHCONTRASTW), 0, nullptr };
    check(observed("visual-settings-backup", [&] {
        return SystemParametersInfoW(SPI_GETHIGHCONTRAST, sizeof(before), &before, 0) != FALSE;
    }), "visual rollback state unavailable");
    RECT rectangle{};
    check(GetWindowRect(window, &rectangle) != FALSE, "visual rollback rectangle unavailable");
    const auto dpi = GetDpiForWindow(window);
    Child worker;
    const auto deadline = GetTickCount64() + 10000;
    std::string failure;
    try {
        const auto args = L"--mode visual-worker --target-pid " + std::to_wstring(owner) +
            L" --target-window " + std::to_wstring(reinterpret_cast<uintptr_t>(window)) +
            L" --root " + recap::quoted(root.wstring()) + L" --report " + recap::quoted(liveReportPath.wstring());
        start(worker, recap::modulePath(), args);
        observed("visual-helper-registration", [&] {
            observer.bindHelper(worker.pid, worker.process.get(), worker.primaryThread.get());
        });
        const auto now = GetTickCount64();
        const DWORD remaining = now + 2000 < deadline ? static_cast<DWORD>(deadline - now - 2000) : 0;
        proof::until([&] { return worker.completed(); }, "visual worker operation deadline", remaining);
        check(worker.exit() == 0, "isolated visual assertion failed");
    } catch (const std::exception& error) { failure = error.what(); }
    try {
        const auto now = GetTickCount64();
        worker.stop(now < deadline ? deadline - now : 0);
    } catch (const std::exception& error) {
        failure = error.what();
        worker.process.close();
    }
    checkpoint("ENTER", "visual-settings-rollback");
    before.lpszDefaultScheme = nullptr;
    check(SystemParametersInfoW(SPI_SETHIGHCONTRAST, sizeof(before), &before, 0) != FALSE,
          "visual high contrast rollback failed");
    sendChecked(window, WM_SETTINGCHANGE);
    sendChecked(window, WM_DPICHANGED, MAKEWPARAM(dpi, dpi), reinterpret_cast<LPARAM>(&rectangle));
    checkpoint("EXIT", "visual-settings-rollback");
    if (!failure.empty()) {
        checkpoint("FAIL", "visual-worker");
        throw std::runtime_error(failure);
    }
    checkpoint("EXIT", "visual-worker");
}

recap::Capture golden(const fs::path& source, const std::string& name) {
    std::istringstream input(read(source));
    std::string key, hex;
    while (input >> key >> hex) if (key == name) {
        check(hex.size() % 2 == 0, "golden hex length invalid");
        recap::Capture capture;
        for (size_t index = 0; index < hex.size(); index += 2)
            capture.output.push_back(static_cast<unsigned char>(std::stoul(hex.substr(index, 2), nullptr, 16)));
        return capture;
    }
    throw std::runtime_error("golden fixture absent");
}

void decoder(const fs::path& source, bool onlyMissing) {
    check(!recap::interpret({}, true, 0).opened, "N1 missing frame was accepted as opened");
    if (onlyMissing) return;
    const auto opened = golden(source, "opened"), failed = golden(source, "failed");
    check(recap::interpret(opened, true, 0).opened, "opened golden rejected");
    check(recap::decodeFrame(failed).body == L"Problem.\nRetry.", "failed golden differed");
    for (const size_t offset : { 0u, 4u, 5u, 6u, 8u }) {
        auto invalid = opened;
        invalid.output[offset] = 255;
        check(!recap::interpret(invalid, true, 0).opened, "invalid header accepted");
    }
    for (const size_t length : { 0u, 1u, 11u }) {
        auto truncated = opened;
        truncated.output.resize(length);
        check(!recap::interpret(truncated, true, 0).opened, "truncated frame accepted");
    }
    auto extra = opened;
    extra.output.push_back(0);
    check(!recap::interpret(extra, true, 0).opened, "extra result byte accepted");
    extra = opened;
    extra.output.insert(extra.output.end(), opened.output.begin(), opened.output.end());
    check(!recap::interpret(extra, true, 0).opened, "duplicate result accepted");
    for (const unsigned char invalid : { static_cast<unsigned char>(0), static_cast<unsigned char>(0xff) }) {
        auto broken = failed;
        broken.output[12] = invalid;
        check(!recap::decodeFrame(broken).valid, "invalid outcome text accepted");
    }
    check(!recap::interpret(opened, true, 1).opened, "opened nonzero exit accepted");
    check(!recap::interpret(opened, false, 0).opened, "missing exit query accepted");
    check(!recap::interpret(opened, true, 0, ERROR_READ_FAULT).opened, "I/O fault accepted");
    auto diagnostic = opened;
    diagnostic.diagnostics.push_back('x');
    check(!recap::interpret(diagnostic, true, 0).opened, "opened diagnostic accepted");
    diagnostic = failed;
    diagnostic.diagnosticOverflow = true;
    check(recap::interpret(diagnostic, true, 1).detail.find(L"Problem.\nRetry.") == 0,
          "diagnostic overflow lost failed body");
    check(recap::interpret(failed, true, 0).detail.find(L"exit status: 0") != std::wstring::npos,
          "inconsistent failure exit was hidden");
    recap::Capture fragments;
    for (const auto byte : opened.output)
        recap::appendBounded(fragments.output, &byte, 1, recap::FrameLimit + 1, fragments.outputOverflow);
    check(recap::interpret(fragments, true, 0).opened, "fragmented golden failed");
}

struct FakeOperations {
    uint64_t clock = 0;
    bool exited = false, done = false, fault = false, cancelled = false;
    unsigned int cancellations = 0, terminations = 0;
    uint64_t now() const { return clock; }
    recap::ProcessState processState() const { return exited ? recap::ProcessState::exited : recap::ProcessState::running; }
    bool workerDone() const { return done; }
    bool ioFailed() const { return fault; }
    void finalizeIo() {}
    void stopIo() { cancelled = true; }
    bool terminateOwned() { ++terminations; exited = true; return true; }
    void cancelIo() { ++cancellations; }
    void wait(DWORD delay) {
        clock += delay;
        if (fault && cancellations >= 2) done = true;
    }
};

struct FakeStopOperations {
    std::vector<DWORD> waits;
    size_t index = 0;
    uint64_t clock = 0;
    bool termination = true;
    DWORD terminationError = 0, lastError = 0;
    unsigned int terminations = 0;
    uint64_t now() const { return clock; }
    DWORD wait(DWORD timeout) {
        clock += timeout;
        const auto result = waits[std::min(index++, waits.size() - 1)];
        lastError = result == WAIT_FAILED ? ERROR_INVALID_HANDLE : 0;
        return result;
    }
    bool terminate() {
        ++terminations;
        lastError = termination ? 0 : terminationError;
        return termination;
    }
    DWORD error() const { return lastError; }
};

void cleanupCases() {
    FakeStopOperations signaled{ { WAIT_OBJECT_0 } };
    check(stopOwned(signaled).complete && signaled.terminations == 0,
          "signaled cleanup attempted termination");
    FakeStopOperations race{ { WAIT_TIMEOUT, WAIT_OBJECT_0 } };
    race.termination = false;
    race.terminationError = ERROR_ACCESS_DENIED;
    const auto raced = stopOwned(race);
    check(raced.complete && raced.terminationError == ERROR_ACCESS_DENIED && race.terminations == 1,
          "termination race did not require confirmed signaling");
    FakeStopOperations denied{ { WAIT_TIMEOUT } };
    denied.termination = false;
    denied.terminationError = ERROR_ACCESS_DENIED;
    const auto live = stopOwned(denied);
    check(!live.complete && live.terminationError == ERROR_ACCESS_DENIED && denied.clock == recap::CleanupTimeout,
          "live access denial was accepted");
    FakeStopOperations invalid{ { WAIT_FAILED } };
    const auto failed = stopOwned(invalid);
    check(!failed.complete && failed.waitError == ERROR_INVALID_HANDLE && invalid.terminations == 0,
          "failed cleanup wait was accepted");
    FakeStopOperations timeout{ { WAIT_TIMEOUT } };
    check(!stopOwned(timeout).complete && timeout.clock == recap::CleanupTimeout && timeout.terminations == 1,
          "cleanup deadline was not enforced");
    FakeStopOperations repeated{ { WAIT_OBJECT_0 } };
    check(stopOwned(repeated).complete && stopOwned(repeated).complete && repeated.terminations == 0,
          "repeated confirmed cleanup was not idempotent");
}

void windowCorrelationCases() {
    const auto fact = [](DWORD event, uint64_t time, bool known) {
        proof::WindowFact value;
        value.window = 100;
        value.event = event;
        value.generated = time;
        value.generated32 = static_cast<DWORD>(time);
        value.received = { time, time * 10 };
        value.sourceThread = 77;
        value.sourceOwner = 9;
        value.owner = known ? 9 : 0;
        value.thread = known ? 77 : 0;
        value.kind = known ? proof::WindowKind::other : proof::WindowKind::unknown;
        value.present = value.identityKnown = value.geometryKnown = value.hierarchyKnown = value.metadataKnown = known;
        value.topLevel = value.onScreen = known;
        value.visible = event == EVENT_OBJECT_SHOW && known;
        return value;
    };
    const std::vector<proof::WindowFact> safe{
        fact(EVENT_OBJECT_CREATE, 10, false), fact(EVENT_OBJECT_SHOW, 20, true),
        fact(EVENT_OBJECT_DESTROY, 30, false)
    };
    const auto recovered = proof::correlateWindows(safe, true, true);
    check(recovered[0].derived && recovered[0].identityKnown && recovered[0].evidence == 1 &&
          recovered[2].derived && !safe[0].present && !safe[0].geometryKnown && !safe[0].metadataKnown,
          "same-lifetime recovery altered raw facts or failed identity");
    std::vector<proof::WindowFact> reused{
        fact(EVENT_OBJECT_CREATE, 10, false), fact(EVENT_OBJECT_DESTROY, 20, false),
        fact(EVENT_OBJECT_CREATE, 30, true), fact(EVENT_OBJECT_DESTROY, 40, true)
    };
    const auto reuse = proof::correlateWindows(reused, true, true);
    check(!reuse[0].identityKnown && reuse[0].lifetime != reuse[2].lifetime &&
          reuse[0].endTick == 20 && reuse[2].beginTick == 30,
          "identity crossed HWND reuse");
    auto conflict = safe;
    conflict[0] = fact(EVENT_OBJECT_CREATE, 10, true);
    conflict[1].owner = 10;
    conflict[1].sourceOwner = 10;
    check(proof::correlateWindows(conflict, true, true)[0].conflict, "conflicting owners were merged");
    auto threads = safe;
    threads[0].sourceThread = 88;
    threads[0].sourceOwner = 10;
    check(!proof::correlateWindows(threads, true, true)[0].identityKnown, "incompatible source thread was accepted");
    auto sourceOwner = safe;
    sourceOwner[1].sourceOwner = 10;
    check(proof::correlateWindows(sourceOwner, true, true)[1].conflict,
          "matching thread number hid a conflicting source owner");
    std::vector<proof::WindowFact> missingShow{
        fact(EVENT_OBJECT_CREATE, 10, true), fact(EVENT_OBJECT_SHOW, 20, false),
        fact(EVENT_OBJECT_DESTROY, 30, false)
    };
    const auto visibility = proof::correlateWindows(missingShow, true, true);
    check(visibility[1].identityKnown && visibility[1].visibilityMissing,
          "derived identity fabricated missing SHOW visibility");
    check(!proof::correlateWindows({ fact(EVENT_OBJECT_CREATE, 10, false), fact(EVENT_OBJECT_DESTROY, 20, false) },
                                   true, true)[0].identityKnown, "missing identity evidence was accepted");
    check(!proof::correlateWindows(safe, false, true)[0].identityKnown, "invalid clocks allowed identity recovery");
    check(!proof::correlateWindows(safe, true, false)[0].identityKnown, "capture loss allowed identity recovery");
}

void consoleBindingCases() {
    const auto fact = [](DWORD event, uint64_t tick, DWORD owner, DWORD thread, bool present = true) {
        proof::WindowFact value;
        value.window = 100;
        value.event = event;
        value.generated = tick;
        value.received = { tick, tick * 10 };
        value.sourceOwner = 9;
        value.sourceThread = 77;
        value.sourceThreadCreation = 100;
        value.sourceThreadKnown = true;
        value.sourceActor = 1;
        value.owner = owner;
        value.thread = thread;
        value.reportedActor = owner == 9 ? 1 : owner == 10 ? 2 : owner == 11 ? 3 : 0;
        value.kind = present ? proof::WindowKind::console : proof::WindowKind::unknown;
        value.identityKnown = value.metadataKnown = value.present = value.geometryKnown = value.hierarchyKnown = present;
        value.topLevel = value.onScreen = present;
        value.visible = present && event == EVENT_OBJECT_SHOW;
        return value;
    };
    const std::vector<proof::WindowFact> raw{
        fact(EVENT_OBJECT_CREATE, 10, 9, 77), fact(EVENT_OBJECT_SHOW, 20, 10, 88),
        fact(EVENT_OBJECT_DESTROY, 50, 0, 0, false)
    };
    proof::ConsoleBinding binding;
    binding.window = 100;
    binding.lifetime = 1;
    binding.presenterActor = 1;
    binding.clientActor = 2;
    binding.observerActor = 3;
    binding.presenter = 9;
    binding.presenterThread = 77;
    binding.sourceThreadCreation = 100;
    binding.client = 10;
    binding.clientThread = 88;
    binding.observer = 11;
    binding.observerThread = 99;
    binding.role = proof::PresenterRole::classic;
    binding.presenterKnown = binding.sourceThreadBound = binding.presenterEtw = true;
    binding.clientKnown = binding.clientThreadBound = binding.clientEtw = binding.association = binding.noOtherClients = true;
    binding.control = binding.membership = binding.sampleMapped = binding.observerKnown = binding.observerAttached = true;
    binding.clientEnded = binding.departed = binding.observerOnly = binding.observerEnded = binding.observerDetached = true;
    binding.clientEndTick = 30;
    binding.departureQpc = 300;
    binding.observerEndTick = 40;
    binding.detachQpc = 400;
    size_t cases = 0;
    const auto expect = [&](bool result, const char* message) {
        ++cases;
        if (!result && liveReport) { *liveReport << "DIAG console-binding-case-failed index=" << cases << "\n"; liveReport->flush(); }
        check(result, message);
    };
    const auto resolved = [&](const proof::ConsoleBinding& candidate) {
        return proof::correlateWindows(raw, true, true, { candidate });
    };
    expect(!proof::correlateWindows(raw, true, true)[0].identityKnown, "unbound classic projection was accepted");
    const auto valid = resolved(binding);
    expect(valid[0].consoleBound && valid[1].consoleBound && valid[0].owner == 10 &&
           raw[0].owner == 9 && raw[1].owner == 10 && !raw[0].visible && raw[1].visible,
           "bound projection lost raw identity or visibility");
    auto late = raw;
    late[0].owner = 10;
    late[0].thread = 88;
    late[0].reportedActor = 2;
    expect(proof::correlateWindows(late, true, true, { binding })[0].identityKnown, "late CREATE projection was rejected");
    auto changed = binding;
    changed.role = proof::PresenterRole::other;
    expect(!resolved(changed)[0].identityKnown, "untrusted presenter was accepted");
    changed = binding;
    changed.presenterKnown = false;
    expect(!resolved(changed)[0].identityKnown, "unknown presenter instance was accepted");
    changed = binding;
    changed.sourceThreadBound = false;
    expect(!resolved(changed)[0].identityKnown, "unknown presenter thread was accepted");
    auto wrongSource = raw;
    wrongSource[1].sourceThreadCreation = 101;
    expect(!proof::correlateWindows(wrongSource, true, true, { binding })[1].identityKnown,
           "source thread instance mismatch was accepted");
    changed = binding;
    changed.clientKnown = false;
    expect(!resolved(changed)[0].identityKnown, "unknown client instance was accepted");
    changed = binding;
    changed.clientThread = 89;
    expect(!resolved(changed)[1].identityKnown, "wrong client thread was accepted");
    changed = binding;
    changed.association = false;
    expect(!resolved(changed)[0].identityKnown, "missing console association was accepted");
    changed = binding;
    changed.membership = false;
    expect(!resolved(changed)[0].identityKnown, "missing control membership was accepted");
    auto ordinary = raw;
    ordinary[0].kind = ordinary[1].kind = proof::WindowKind::other;
    expect(!proof::correlateWindows(ordinary, true, true, { binding })[1].identityKnown,
           "classic binding weakened ordinary-window identity");
    auto reused = raw;
    reused.push_back(fact(EVENT_OBJECT_CREATE, 60, 10, 88));
    reused.push_back(fact(EVENT_OBJECT_SHOW, 70, 10, 88));
    reused.push_back(fact(EVENT_OBJECT_DESTROY, 80, 0, 0, false));
    const auto reuse = proof::correlateWindows(reused, true, true, { binding });
    expect(!reuse[3].identityKnown && !reuse[3].completeControl, "binding crossed HWND reuse");
    auto recreated = raw;
    recreated.insert(recreated.begin() + 1, fact(EVENT_OBJECT_CREATE, 15, 9, 77));
    expect(proof::correlateWindows(recreated, true, true, { binding })[0].conflict, "recreated lifetime was accepted");
    auto missing = raw;
    missing[1].geometryKnown = missing[1].metadataKnown = false;
    const auto noGeometry = proof::correlateWindows(missing, true, true, { binding });
    expect(noGeometry[1].visibilityMissing && !noGeometry[1].completeControl, "binding fabricated SHOW geometry");
    expect(!proof::correlateWindows(raw, false, true, { binding })[0].identityKnown, "binding ignored invalid clocks");
    expect(!proof::correlateWindows(raw, true, false, { binding })[0].identityKnown, "binding ignored capture loss");
    expect(valid[0].completeControl && valid[2].completeControl, "complete control lifetime was not identified");
    changed = binding;
    changed.control = false;
    const auto product = resolved(changed);
    expect(!product[1].completeControl && proof::visibleBoundConsole(raw[1], product[1]),
           "visible product binding was exempted");
    auto teardown = raw;
    teardown.insert(teardown.begin() + 2, fact(EVENT_OBJECT_HIDE, 35, 11, 99));
    expect(proof::correlateWindows(teardown, true, true, { binding })[2].identityKnown,
           "proven observer teardown projection was rejected");
    changed = binding;
    changed.departed = false;
    expect(!proof::correlateWindows(teardown, true, true, { changed })[2].identityKnown,
           "observer projection without departure was accepted");
    auto fallback = teardown;
    fallback.insert(fallback.begin() + 3, fact(EVENT_OBJECT_HIDE, 45, 9, 77));
    auto early = raw;
    early.insert(early.begin() + 2, fact(EVENT_OBJECT_HIDE, 25, 9, 77));
    expect(proof::correlateWindows(fallback, true, true, { binding })[3].identityKnown &&
           !proof::correlateWindows(early, true, true, { binding })[2].identityKnown,
           "host fallback lacked its zero-client interval");
    check(cases == 22 && liveReport, "binding case count or report is missing");
    *liveReport << "DIAG console-binding-cases cases=22 passed=22\n";
    liveReport->flush();
}

void supervision() {
    FakeOperations race;
    race.fault = true;
    const auto result = recap::supervise(race, 0);
    check(result.failed && race.cancellations >= 2 && race.terminations == 1,
          "cancellation-before-request race was not retried");
    FakeOperations finalDrain;
    finalDrain.exited = true;
    const auto expired = recap::supervise(finalDrain, 0);
    check(expired.failed && !expired.workerDone && expired.cleanupUncertain &&
          finalDrain.clock == recap::CleanupTimeout, "final-drain deadline could appear successful");
    FakeOperations unresponsive;
    const auto timedOut = recap::supervise(unresponsive, 0);
    check(timedOut.failed && timedOut.cleanupUncertain && !timedOut.workerDone &&
          unresponsive.clock == recap::StartupTimeout + recap::CleanupTimeout,
          "unresponsive worker cleanup was not bounded");
    recap::Publication publication;
    check(publication.claim() && !publication.claim(), "late completion could publish twice");
    cleanupCases();
    handleClassificationCases();
    uiaOutputCases();
    windowCorrelationCases();
    observed("console-binding-cases", [] { consoleBindingCases(); });
}

void finalObserverCases() {
    const auto event = [](DWORD pid, DWORD parent, LONGLONG time, bool start) {
        proof::ProcessEvent value;
        value.pid = pid; value.parent = parent; value.timestamp = time; value.start = start;
        value.exitKnown = !start;
        return value;
    };
    const std::vector<proof::ProcessEvent> captured{
        event(1, 90, 100, true), event(2, 1, 200, true), event(2, 1, 400, false), event(1, 90, 800, false),
        event(9, 90, 110, true), event(9, 90, 150, false), event(9, 90, 300, true), event(9, 90, 350, false)
    };
    size_t cases = 0;
    const auto expect = [&](bool value, const char* message) {
        ++cases;
        if (!value && liveReport) { *liveReport << "DIAG final-observer-case-failed index=" << cases << "\n"; liveReport->flush(); }
        check(value, message);
    };
    const proof::ProcessGraph graph(captured);
    const auto root = graph.unique(1, 500);
    const auto lineage = graph.descendants({ root });
    expect(root != SIZE_MAX && lineage.owned.size() == 2 && lineage.ambiguous == SIZE_MAX &&
           lineage.missingParent == SIZE_MAX, "unrelated PID recycling changed retained lineage");
    auto reused = captured;
    reused.push_back(event(1, 90, 1000, true));
    reused.push_back(event(3, 1, 1200, true));
    reused.push_back(event(3, 1, 1300, false));
    reused.push_back(event(1, 90, 1500, false));
    const proof::ProcessGraph recycled(reused);
    const auto recycledLineage = recycled.descendants({ recycled.unique(1, 500) });
    expect(recycledLineage.owned.size() == 2 && recycledLineage.ambiguous == SIZE_MAX &&
           recycledLineage.missingParent == SIZE_MAX &&
           recycled.unique(1, 500) != recycled.unique(1, 1200), "new recycled-parent children were attached to an ended root");
    auto ambiguous = captured;
    ambiguous.push_back(event(1, 90, 300, true));
    expect(proof::ProcessGraph(ambiguous).unique(1, 500) == SIZE_MAX, "ambiguous retained root was accepted");
    expect(graph.unique(99, 500) == SIZE_MAX, "missing required root was invented");
    auto orphan = captured;
    orphan.push_back(event(3, 1, 900, true));
    const proof::ProcessGraph missingParent(orphan);
    expect(missingParent.descendants({ missingParent.unique(1, 500) }).missingParent != SIZE_MAX,
           "a child was attached across an absent parent interval");
    auto unrelated = captured;
    unrelated.push_back(event(9, 90, 120, true));
    const proof::ProcessGraph unrelatedConflict(unrelated);
    const auto unrelatedLineage = unrelatedConflict.descendants({ unrelatedConflict.unique(1, 500) });
    expect(unrelatedLineage.owned.size() == 2 && unrelatedLineage.ambiguous == SIZE_MAX &&
           unrelatedLineage.missingParent == SIZE_MAX,
           "unrelated ambiguous instances corrupted the retained graph");

    proof::WindowFact raw;
    raw.window = 100;
    raw.event = EVENT_OBJECT_SHOW;
    raw.sourceOwner = raw.owner = 10;
    raw.sourceThread = raw.thread = 99;
    raw.kind = proof::WindowKind::other;
    raw.identityKnown = raw.metadataKnown = raw.present = raw.visible = raw.geometryKnown = raw.hierarchyKnown = true;
    const proof::HelperScopeEvidence verified{ true, true, true, true, true, false, false };
    expect(proof::verifiedHelperSurface(raw, verified), "verified helper surface was not scoped");
    auto scope = verified; scope.registered = false;
    expect(!proof::verifiedHelperSurface(raw, scope), "an unregistered source was scoped");
    scope = verified; scope.image = false;
    expect(!proof::verifiedHelperSurface(raw, scope), "unknown helper image was scoped");
    scope = verified; scope.instance = false;
    expect(!proof::verifiedHelperSurface(raw, scope), "unknown helper instance was scoped");
    scope = verified; scope.thread = false;
    expect(!proof::verifiedHelperSurface(raw, scope), "unknown helper thread was scoped");
    scope = verified; scope.ownerCompatible = false;
    expect(!proof::verifiedHelperSurface(raw, scope), "conflicting raw owner was scoped");
    scope = verified; scope.productAssociation = true;
    expect(!proof::verifiedHelperSurface(raw, scope), "product-linked facts were scoped");
    scope = verified; scope.terminalAssociation = true;
    expect(!proof::verifiedHelperSurface(raw, scope), "console-linked facts were scoped");
    auto terminal = raw; terminal.kind = proof::WindowKind::console;
    expect(!proof::verifiedHelperSurface(terminal, verified), "terminal class was hidden by helper registration");
    auto vanished = raw;
    vanished.event = EVENT_OBJECT_CREATE; vanished.kind = proof::WindowKind::unknown;
    vanished.owner = vanished.thread = 0;
    vanished.metadataKnown = vanished.identityKnown = vanished.present = vanished.visible = false;
    expect(proof::verifiedHelperSurface(vanished, verified) && !vanished.metadataKnown && !vanished.present,
           "verified helper scope fabricated vanished-window metadata");
    vanished.event = EVENT_OBJECT_SHOW;
    expect(!proof::verifiedHelperSurface(vanished, verified), "unknown SHOW visibility was scoped");
    auto show = raw; show.generated = 10; show.received = { 10, 100 };
    auto create = raw; create.event = EVENT_OBJECT_CREATE; create.generated = 20; create.received = { 20, 200 };
    const auto windows = proof::correlateWindows({ show, create }, true, true);
    scope = verified; scope.registered = false;
    expect(windows[0].conflict && windows[1].conflict && show.generated == 10 && create.generated == 20 &&
           !proof::verifiedHelperSurface(show, scope), "unclassified SHOW-before-CREATE was erased");

    std::set<std::string> codes;
    bool safeCodes = true;
    for (const auto* code : proof::FinalConditions) {
        const std::string text(code);
        safeCodes = safeCodes && text.rfind("final-", 0) == 0 && text.size() <= 80 &&
            text.find_first_not_of("abcdefghijklmnopqrstuvwxyz-") == std::string::npos && codes.insert(text).second;
    }
    expect(safeCodes && codes.size() == 31, "final condition catalog is unsafe or incomplete");
    bool fixedFailure = false;
    try { throw proof::FinalObservationFailure("final-root-image-mismatch", "final-root-registration"); }
    catch (const std::exception& error) {
        const auto* final = dynamic_cast<const proof::FinalObservationFailure*>(&error);
        fixedFailure = final && std::string(failureCode(error)) == "final-root-image-mismatch" &&
            std::string(final->stage) == "final-root-registration";
    }
    expect(fixedFailure, "early final condition reverted to an unclassified calibration failure");
    check(cases == 20 && liveReport, "final observer scenario count or report differs");
    *liveReport << "DIAG final-observer-cases cases=20 passed=20 fixed_conditions=31\n";
    liveReport->flush();
}

void sourceLifetimeCases() {
    using Kind = proof::LifecycleKind;
    const auto process = [](DWORD pid, DWORD parent, LONGLONG time, Kind kind) {
        proof::ProcessEvent value;
        value.pid = pid; value.parent = parent; value.timestamp = time; value.start = kind == Kind::start;
        value.rundown = kind == Kind::rundownBegin ? proof::Rundown::begin
            : kind == Kind::rundownEnd ? proof::Rundown::end : proof::Rundown::none;
        value.exitKnown = kind == Kind::end;
        value.version = 2;
        return value;
    };
    const std::vector<proof::ProcessEvent> captured{
        process(11, 1, 1000000, Kind::rundownBegin), process(11, 1, 3000000, Kind::rundownEnd)
    };
    const proof::ProcessGraph graph(captured);
    const std::vector<proof::ThreadEvent> threadEvents{
        { 11, 44, 1200000, Kind::start, 2 }, { 11, 44, 1700000, Kind::end, 2 }
    };
    const proof::ThreadGraph threads(threadEvents);
    proof::WindowFact raw;
    raw.sourceThread = 44; raw.sourceError = ERROR_INVALID_PARAMETER;
    raw.generated = 1500; raw.received = { 2000, 2000000, 2000001 };
    const std::vector<proof::SourceWitness> retained{ { 11, 44, 11, 44, 1300000, 1600000 } };
    const auto resolve = [&](const proof::WindowFact& fact, const proof::ProcessGraph& owners,
                             const proof::ThreadGraph& sources, const std::vector<proof::SourceWitness>& known,
                             bool clocks = true, bool healthy = true) {
        return proof::resolveSource(fact, owners, sources, known, 900000, 1000000, clocks, healthy);
    };
    size_t cases = 0;
    const auto expect = [&](bool value, const char* message) {
        ++cases;
        if (!value && liveReport) { *liveReport << "DIAG source-lifetime-case-failed index=" << cases << "\n"; liveReport->flush(); }
        check(value, message);
    };
    expect(graph.instances.size() == 1 && !graph.instances[0].creationObserved && graph.instances[0].rundownBegin &&
           graph.unique(11, 999999) == SIZE_MAX && graph.unique(11, 1500000) == 0,
           "process rundown fabricated an earlier creation");
    expect(graph.instances[0].rundownEnd && !graph.instances[0].ended && !graph.instances[0].end.exitKnown,
           "process rundown end was treated as exit");
    auto actual = captured; actual.insert(actual.begin(), process(11, 1, 950000, Kind::start));
    const proof::ProcessGraph combined(actual);
    expect(combined.instances.size() == 1 && combined.instances[0].creationObserved &&
           combined.instances[0].rundownBegin && combined.unique(11, 1500000) == 0,
           "compatible actual start and rundown did not retain both provenances");
    auto conflict = captured; conflict.push_back(process(11, 1, 1200000, Kind::start));
    expect(proof::ProcessGraph(conflict).unique(11, 1500000) == SIZE_MAX, "overlapping rundown and new start were merged");
    auto duplicate = captured; duplicate.push_back(process(11, 1, 1100000, Kind::rundownBegin));
    expect(proof::ProcessGraph(duplicate).unique(11, 1500000) == SIZE_MAX, "duplicate rundown was silently merged");
    auto parent = captured; parent.push_back(process(1, 99, 950000, Kind::start));
    const proof::ProcessGraph parentGraph(parent);
    expect(parentGraph.descendants({ parentGraph.unique(1, 1500000) }).owned.size() == 1,
           "rundown parent PID was presented as observed creation ancestry");
    const proof::ThreadGraph rundownThreads({
        { 11, 44, 1100000, Kind::rundownBegin, 2 }, { 11, 44, 3000000, Kind::rundownEnd, 2 }
    });
    expect(rundownThreads.instances.size() == 1 && !rundownThreads.instances[0].created &&
           !rundownThreads.instances[0].ended && rundownThreads.instances[0].rundownEnd &&
           rundownThreads.unique(44, 1000000) == SIZE_MAX, "thread rundown fabricated creation or exit");
    const auto recovered = resolve(raw, graph, threads, {});
    expect(recovered.known && recovered.owner == 11 && !recovered.retained && !recovered.liveQuery &&
           recovered.rundown && !recovered.threadCreation && raw.sourceOwner == 0 &&
           raw.sourceError == ERROR_INVALID_PARAMETER && !raw.sourceThreadKnown,
           "delayed thread lifetime recovery changed raw query facts");
    const auto witnessed = resolve(raw, graph, threads, retained);
    expect(witnessed.known && witnessed.retained && witnessed.threadCreation == 44 &&
           std::string(witnessed.reason) == "retained-source-identity", "retained source identity was not used first");
    auto live = raw; live.sourceOwner = 11; live.sourceThreadKnown = live.sourceLive = true;
    live.sourceThreadCreation = 44; live.sourceObservedQpc = 1600000;
    const auto queried = resolve(live, graph, threads, {});
    expect(queried.known && queried.liveQuery && !queried.retained && queried.threadCreation == 44,
           "unique live source query lost its provenance");
    const proof::ThreadGraph reused({
        { 11, 44, 1200000, Kind::start, 2 }, { 11, 44, 1490000, Kind::end, 2 },
        { 11, 44, 1500000, Kind::start, 2 }, { 11, 44, 1700000, Kind::end, 2 }
    });
    const proof::ThreadGraph missingFirstStart({
        { 11, 44, 1490000, Kind::end, 2 }, { 11, 44, 1500000, Kind::start, 2 },
        { 11, 44, 1700000, Kind::end, 2 }
    });
    expect(!resolve(raw, graph, reused, retained).known && !resolve(raw, graph, missingFirstStart, retained).known,
           "coarse generation clock erased a possible reused TID");
    auto overlapping = threadEvents; overlapping.push_back({ 11, 44, 1300000, Kind::start, 2 });
    expect(!resolve(raw, graph, proof::ThreadGraph(overlapping), retained).known, "overlapping thread lifetimes were accepted");
    auto wrongOwner = raw; wrongOwner.sourceOwner = 12;
    expect(!resolve(wrongOwner, graph, threads, retained).known, "conflicting raw source owner was overwritten");
    expect(!resolve(raw, proof::ProcessGraph(std::vector<proof::ProcessEvent>{}), threads, retained).known,
           "missing process interval was invented");
    expect(!resolve(raw, graph, proof::ThreadGraph(std::vector<proof::ThreadEvent>{}), retained).known,
           "missing thread interval was invented");
    expect(!proof::nativeEnvironmentAllowed(proof::ObservationProfile::nativeFixture, true, recovered.known, false, false, false),
           "recovered source identity bypassed the exact image requirement");
    auto clock = raw; clock.received.afterQpc = clock.received.qpc - 1;
    expect(!resolve(clock, graph, threads, retained).known && !resolve(raw, graph, threads, retained, false).known,
           "invalid clock evidence was accepted");
    expect(!resolve(raw, graph, threads, retained, true, false).known, "lost capture was accepted");
    bool recordBound = false;
    try {
        std::vector<proof::ThreadEvent> full(proof::ThreadRecordLimit);
        proof::appendThreadEvent(full, threadEvents[0]);
    } catch (const std::runtime_error& error) { recordBound = std::string(failureCode(error)) == "thread-record-bound"; }
    expect(recordBound, "thread record overflow was accepted");
    bool identityBound = false;
    try {
        std::vector<proof::ThreadEvent> full;
        for (size_t index = 0; index <= proof::ThreadIdentityLimit; ++index)
            full.push_back({ 11, static_cast<DWORD>(index + 1), 1200000, Kind::start, 2 });
        const proof::ThreadGraph excessive(full);
        (void)excessive;
    } catch (const std::runtime_error& error) { identityBound = std::string(failureCode(error)) == "lifetime-identity-bound"; }
    expect(identityBound, "thread identity overflow was accepted");
    expect(!resolve(raw, proof::ProcessGraph({ captured[1] }), threads, retained).known,
           "end rundown supplied unobserved earlier coverage");
    const proof::ProcessGraph recycledOwner({
        captured[0], process(11, 1, 1300000, Kind::end), process(11, 1, 1400000, Kind::start)
    });
    expect(!resolve(raw, recycledOwner, threads, retained).known, "thread source crossed a process PID reuse");
    auto wrongCreation = retained; wrongCreation.push_back({ 11, 44, 11, 45, 1300000, 1600000 });
    expect(!resolve(raw, graph, threads, wrongCreation).known, "contradictory retained thread creation was accepted");
    auto stale = retained; stale[0].observedQpc = stale[0].liveThroughQpc = 2000000;
    const auto withoutRetained = resolve(raw, graph, threads, stale);
    expect(withoutRetained.known && !withoutRetained.retained && !withoutRetained.threadCreation,
           "retained identity was used outside its witnessed interval");
    check(cases == 24 && liveReport, "source lifetime scenario count or report differs");
    *liveReport << "DIAG source-lifetime-cases cases=24 passed=24 thread_record_limit=65536 thread_identity_limit=32768 raw_facts_preserved=1\n";
    liveReport->flush();
}

void semanticEvidenceCases() {
    const std::wstring powershell = L"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const auto event = [](DWORD pid, DWORD parent, LONGLONG time, bool start, const std::wstring& command = L"") {
        proof::ProcessEvent value;
        value.pid = pid; value.parent = parent; value.timestamp = time; value.start = start;
        value.diagnosticCommand = command;
        return value;
    };
    const auto command = recap::quoted(powershell) + L" -NoProfile -NonInteractive -Command " +
        recap::quoted(proof::SemanticListenerScript);
    const std::vector<proof::ProcessEvent> records{
        event(10, 9, 100, true), event(11, 10, 210, true, command),
        event(11, 10, 280, false), event(10, 9, 500, false)
    };
    const proof::ProcessGraph graph(records);
    const auto caller = graph.unique(10, 200);
    proof::SemanticOperation operation{ 1, "listener-query", proof::SemanticListenerScript, 200, 300, true, true };
    const auto image = [&](size_t) { return powershell; };
    const auto binding = proof::bindSemanticOperation(graph, caller, operation, powershell, image);
    const proof::ThreadGraph threads({ { 11, 44, 211, proof::LifecycleKind::start, 2 },
                                       { 11, 44, 279, proof::LifecycleKind::end, 2 } });
    proof::SourceResolution source;
    source.known = true; source.owner = 11; source.process = graph.unique(11, 220); source.thread = 0;
    source.earliest = 215; source.latest = 225;
    size_t cases = 0;
    const auto expect = [&](bool value, const char* message) {
        ++cases;
        if (!value && liveReport) { *liveReport << "DIAG semantic-case-failed index=" << cases << "\n"; liveReport->flush(); }
        check(value, message);
    };
    expect(binding.process == source.process && binding.fixedScript &&
           proof::semanticSourceMatches(graph, threads, binding.process, source),
           "exact operation process and source thread did not bind");
    expect(proof::bindSemanticOperation(graph, graph.unique(99, 200), operation, powershell, image).process == SIZE_MAX,
           "a caller PID without a captured instance bound an operation");
    auto parent = records; parent[1].parent = 12; parent[2].parent = 12;
    expect(proof::bindSemanticOperation(proof::ProcessGraph(parent), caller, operation, powershell, image).process == SIZE_MAX,
           "a wrong creation parent bound an operation");
    expect(proof::bindSemanticOperation(graph, caller, operation, powershell,
        [](size_t) { return L"X:\\other\\powershell.exe"; }).process == SIZE_MAX,
        "a matching basename substituted for the exact helper image");
    auto time = operation; time.begin = 220;
    expect(proof::bindSemanticOperation(graph, caller, time, powershell, image).process == SIZE_MAX,
           "a helper created outside its request fence was bound");
    auto script = records; script[1].diagnosticCommand += L" extra";
    expect(proof::bindSemanticOperation(proof::ProcessGraph(script), caller, operation, powershell, image).process == SIZE_MAX,
           "a different helper argument list was accepted");
    const proof::ThreadGraph foreignThreads({ { 12, 44, 211, proof::LifecycleKind::start, 2 } });
    expect(!proof::semanticSourceMatches(graph, foreignThreads, binding.process, source),
           "a thread from another process was bound to the operation");
    const auto activation = std::wstring(L"Start-Process explorer.exe -ArgumentList 'shell:AppsFolder\\") + proof::SemanticAumid + L"'";
    expect(proof::semanticFixedScript("aumid-activate", activation) &&
           !proof::semanticFixedScript("listener-query", activation), "activation was confused with a query");
    auto duplicated = records;
    duplicated.push_back(event(12, 10, 220, true, command));
    duplicated.push_back(event(12, 10, 270, false));
    expect(proof::bindSemanticOperation(proof::ProcessGraph(duplicated), caller, operation, powershell, image).process == SIZE_MAX,
           "competing helper instances were collapsed");
    auto unknown = operation; unknown.name = "unknown";
    auto incomplete = operation; incomplete.ended = false;
    expect(proof::bindSemanticOperation(graph, caller, unknown, powershell, image).process == SIZE_MAX &&
           proof::bindSemanticOperation(graph, caller, incomplete, powershell, image).process == SIZE_MAX,
           "unknown or incomplete operation evidence was accepted");
    proof::SemanticImageGroups groups;
    const std::vector<proof::SemanticKnownImage> known{ { L"C:\\Windows\\System32\\svchost.exe", "system-service-host-image", true } };
    const auto exact = groups.classify(known[0].path, known);
    expect(exact.exact && exact.broker && exact.opaque == 0 && !groups.classify(L"svchost.exe", known).exact,
           "system image role was inferred from a basename");
    const auto opaque = groups.classify(L"X:\\fixture\\one.exe", known);
    const auto equivalent = groups.classify(L"x:\\FIXTURE\\ONE.exe", known);
    expect(opaque.opaque == 1 && equivalent.opaque == opaque.opaque &&
           std::string(opaque.label) == "unmatched-image", "unmatched image equivalence was lost or named");
    expect(groups.classify(L"X:\\different\\one.exe", known).opaque == 2,
           "different full images shared an opaque group");
    expect(std::string(proof::semanticAssociation(false, false, false, false, false, exact.broker)) ==
           "shared-broker-request-unknown", "recognized broker invented a delegated request association");
    proof::WindowFact visible;
    visible.event = EVENT_OBJECT_SHOW; visible.metadataKnown = visible.geometryKnown = visible.hierarchyKnown = true;
    visible.present = visible.visible = visible.topLevel = visible.onScreen = true;
    proof::WindowResolution console;
    console.consoleBound = console.identityKnown = true; console.kind = proof::WindowKind::console;
    expect(proof::visibleBoundConsole(visible, console) && visible.visible && !console.completeControl,
           "diagnostic image recognition suppressed visible product-console evidence");
    proof::WindowFact created, destroyed;
    created.event = EVENT_OBJECT_CREATE; destroyed.event = EVENT_OBJECT_DESTROY;
    const proof::HelperScopeEvidence helper{ true, true, true, true, true, false, false };
    expect(!proof::completeNonPresenterTransient({ created, destroyed }, { { 0, 1 }, true, true, true }, helper) &&
           !proof::completeNonPresenterTransient({ destroyed }, { { 0 }, false, true, false }, helper) &&
           !destroyed.identityKnown, "semantic evidence bypassed conflict or DESTROY-only incompleteness");
    check(cases == 16 && liveReport, "semantic scenario count or report differs");
    *liveReport << "DIAG semantic-cases cases=16 passed=16 diagnostic_only=1 acceptance_inputs=0\n";
    liveReport->flush();
}

void observationProfileCases() {
    using Profile = proof::ObservationProfile;
    proof::WindowFact created;
    created.event = EVENT_OBJECT_CREATE;
    created.window = 100;
    created.kind = proof::WindowKind::unknown;
    auto destroyed = created;
    destroyed.event = EVENT_OBJECT_DESTROY;
    const std::vector<proof::WindowFact> raw{ created, destroyed };
    const proof::WindowLifetime life{ { 0, 1 }, true, true, false };
    const proof::HelperScopeEvidence source{ true, true, true, true, true, false, false };
    size_t cases = 0;
    const auto expect = [&](bool value, const char* message) {
        ++cases;
        if (!value && liveReport) { *liveReport << "DIAG observation-profile-case-failed index=" << cases << "\n"; liveReport->flush(); }
        check(value, message);
    };
    expect(proof::completeNonPresenterTransient(raw, life, source) && !raw[0].metadataKnown &&
           raw[0].kind == proof::WindowKind::unknown, "source-bound transient fabricated metadata");
    auto shown = raw; shown[0].event = EVENT_OBJECT_SHOW;
    expect(!proof::completeNonPresenterTransient(shown, life, source), "SHOW was treated as a GUI-only transient");
    auto visible = raw; visible[0].visible = true;
    expect(!proof::completeNonPresenterTransient(visible, life, source), "positive visibility was hidden");
    auto terminal = raw; terminal[0].kind = proof::WindowKind::console;
    expect(!proof::completeNonPresenterTransient(terminal, life, source), "console identity was hidden");
    auto association = source; association.terminalAssociation = true;
    expect(!proof::completeNonPresenterTransient(raw, life, association), "console application association was hidden");
    auto unknown = source; unknown.image = false;
    expect(!proof::completeNonPresenterTransient(raw, life, unknown), "unknown source image was accepted");
    unknown = source; unknown.thread = false;
    expect(!proof::completeNonPresenterTransient(raw, life, unknown), "unknown primary thread was accepted");
    auto conflict = life; conflict.conflict = true;
    expect(!proof::completeNonPresenterTransient(raw, conflict, source), "conflicting transient lifetime was accepted");
    association = source; association.productAssociation = true;
    expect(!proof::completeNonPresenterTransient(raw, life, association), "instrumentation scope hid a product relation");
    expect(proof::nativeEnvironmentAllowed(Profile::nativeFixture, true, true, true, false, false),
           "closed fixture capability was not recognized");
    expect(!proof::nativeEnvironmentAllowed(Profile::nativeFixture, false, true, true, false, false),
           "unverified fixture source enabled closed scope");
    expect(!proof::nativeEnvironmentAllowed(Profile::installedFunctionality, true, true, true, false, false),
           "installed functionality inherited closed scope");
    expect(!proof::nativeEnvironmentAllowed(Profile::installedBusy, true, true, true, false, false),
           "installed busy-port inherited closed scope");
    expect(!proof::nativeEnvironmentAllowed(Profile::calibration, true, true, true, false, false) &&
           !proof::nativeEnvironmentAllowed(Profile::diagnostic, true, true, true, false, false),
           "nonfixture context inherited closed scope");
    expect(!proof::nativeEnvironmentAllowed(Profile::nativeFixture, true, true, true, true, false) &&
           !proof::nativeEnvironmentAllowed(Profile::nativeFixture, true, true, true, false, true),
           "controlled creation or association was scoped as environment");
    proof::ConsoleBinding binding;
    binding.window = binding.lifetime = binding.presenterActor = 1;
    binding.clientActor = 2;
    binding.presenter = binding.presenterThread = 1;
    binding.client = binding.clientThread = 2;
    binding.sourceThreadCreation = 1;
    binding.role = proof::PresenterRole::classic;
    binding.presenterKnown = binding.sourceThreadBound = binding.presenterEtw = true;
    binding.clientKnown = binding.clientThreadBound = binding.clientEtw = binding.association = binding.noOtherClients = true;
    binding.ambient = true;
    expect(proof::ambientConsoleScoped(Profile::nativeFixture, true, binding), "fully verified ambient binding was rejected");
    auto bad = binding; bad.clientKnown = false;
    auto host = binding; host.role = proof::PresenterRole::unknown;
    expect(!proof::ambientConsoleScoped(Profile::nativeFixture, true, bad) &&
           !proof::ambientConsoleScoped(Profile::nativeFixture, true, host), "unknown ambient host or client was accepted");
    bad = binding; bad.noOtherClients = false;
    expect(!proof::ambientConsoleScoped(Profile::nativeFixture, true, bad), "mixed owned client was scoped ambient");
    expect(!proof::ambientConsoleScoped(Profile::installedFunctionality, true, binding) &&
           !proof::ambientConsoleScoped(Profile::installedBusy, true, binding), "installed context accepted unproved ambient activity");
    binding.ambient = false;
    proof::WindowResolution product;
    product.consoleBound = product.identityKnown = true;
    product.kind = proof::WindowKind::console;
    auto productWindow = created;
    productWindow.event = EVENT_OBJECT_SHOW;
    productWindow.metadataKnown = productWindow.geometryKnown = productWindow.hierarchyKnown = true;
    productWindow.topLevel = productWindow.onScreen = productWindow.present = productWindow.visible = true;
    bool productFails = true;
    for (const auto profile : { Profile::calibration, Profile::nativeFixture, Profile::installedFunctionality,
                               Profile::installedBusy, Profile::diagnostic })
        productFails = productFails && proof::visibleBoundConsole(productWindow, product) &&
            !proof::ambientConsoleScoped(profile, true, binding);
    expect(productFails, "a profile hid visible product-terminal evidence");
    check(cases == 20 && liveReport, "profile scenario count or report differs");
    *liveReport << "DIAG observation-profile-cases cases=20 passed=20 profiles=5 raw_metadata_preserved=1\n";
    liveReport->flush();
}

struct CalibrationState {
    const char* stage = "calibration-start";
    proof::Moment begin, beforeAttach;
    proof::WindowFact window;
    bool beginKnown = false, beforeAttachKnown = false;
    bool attached = false, attachmentKnown = false, membersKnown = false;
    bool controlMember = false, observerMember = false, releaseKnown = false, detachKnown = false;
    DWORD attachAttempts = 0, attachError = 0, memberCount = 0, memberError = 0, releaseError = 0, detachError = 0;
};

void reportCalibrationFailure(proof::Observer& observer, std::ofstream& report, const Child& control,
                              const CalibrationState& state, const std::exception& failure) {
    checkpoint("FAIL", "calibration");
    report << "DIAG calibration-failure code=" << failureCode(failure) << " stage=" << state.stage << " primary=1\n";
    FILETIME created{}, exited{}, kernel{}, user{};
    const bool creationKnown = control.process && GetProcessTimes(control.process.get(), &created, &exited, &kernel, &user);
    const auto creationError = control.process && !creationKnown ? GetLastError() : ERROR_SUCCESS;
    const auto wait = control.process ? WaitForSingleObject(control.process.get(), 0) : WAIT_FAILED;
    const auto waitError = control.process && wait == WAIT_FAILED ? GetLastError() : ERROR_SUCCESS;
    const auto creation = (static_cast<uint64_t>(created.dwHighDateTime) << 32) | created.dwLowDateTime;
    report << "DIAG calibration-control pid=" << control.pid << " handle_known=" << static_cast<bool>(control.process)
           << " primary_tid=" << control.primaryTid << " primary_handle_known=" << static_cast<bool>(control.primaryThread)
           << " creation_known=" << creationKnown << " creation=" << creation << " creation_error=" << creationError
           << " wait_known=" << static_cast<bool>(control.process) << " wait=" << wait << " wait_error=" << waitError
           << " attachment_known=" << state.attachmentKnown << " attached=" << state.attached
           << " attach_attempts=" << state.attachAttempts << " attach_error=" << state.attachError
           << " members_known=" << state.membersKnown << " members=" << state.memberCount
           << " member_error=" << state.memberError << " control_member=" << state.controlMember
           << " observer_member=" << state.observerMember << " release_known=" << state.releaseKnown
           << " release_error=" << state.releaseError << " detach_known=" << state.detachKnown
           << " detach_error=" << state.detachError << " begin_known=" << state.beginKnown
           << " begin_tick=" << state.begin.tick << " begin_qpc=" << state.begin.qpc
           << " before_attach_known=" << state.beforeAttachKnown << " before_attach_tick=" << state.beforeAttach.tick
           << " before_attach_qpc=" << state.beforeAttach.qpc << " before_teardown=1\n";
    observer.reportCalibrationWindows(report, control.pid, state.window, state.begin, state.beforeAttach);
    report.flush();
    check(static_cast<bool>(report), "calibration report could not be written");
}

proof::WindowFact calibration(proof::Observer& observer, std::ofstream& report, size_t* started = nullptr) {
    checkpoint("ENTER", "calibration");
    observer.reportTo(report);
    Child control;
    CalibrationState state;
    const auto step = [&](const char* stage, auto action) {
        state.stage = stage;
        observed(stage, action);
    };
    try {
        step("calibration-control-start", [&] {
            state.begin = proof::moment();
            state.beginKnown = true;
            start(control, recap::modulePath(), L"--console-control", CREATE_NEW_CONSOLE);
            if (started) ++*started;
            report << "DIAG calibration-start pid=" << control.pid << " begin_tick=" << state.begin.tick
                   << " begin_qpc=" << state.begin.qpc << "\n";
            report.flush();
            observer.bindClient(control.pid, control.process.get(), control.primaryThread.get(), control.primaryTid, true);
        });
        step("calibration-console-start", [&] {
            proof::until([&] { return observer.console(control.pid); }, "observer did not detect its console control");
        });
        if (observer.observesWindows()) step("calibration-passive-visible", [&] {
            proof::until([&] {
                return std::any_of(observer.windows().begin(), observer.windows().end(), [&](const auto& fact) {
                    return (fact.kind == proof::WindowKind::console || fact.kind == proof::WindowKind::terminal) &&
                        proof::visibleIn(fact, state.begin.tick, GetTickCount64() + 1);
                });
            }, "calibration did not expose a passive visible terminal");
        });
        step("calibration-release-previous", [&] {
            state.beforeAttach = proof::moment();
            state.beforeAttachKnown = true;
            const bool released = FreeConsole() != FALSE;
            state.releaseKnown = true;
            state.releaseError = released ? ERROR_SUCCESS : GetLastError();
            check(released, "observer could not release its previous console");
        });
        step("calibration-attach", [&] {
            proof::until([&] {
                ++state.attachAttempts;
                state.attachmentKnown = true;
                state.attached = AttachConsole(control.pid) != FALSE;
                state.attachError = state.attached ? ERROR_SUCCESS : GetLastError();
                if (state.attached) return true;
                check(state.attachError == ERROR_INVALID_HANDLE && control.exit() == STILL_ACTIVE,
                      "calibration console attachment was inconclusive");
                return false;
            }, "calibration console did not become attachable");
        });
        if (observer.observesWindows()) {
            step("calibration-membership", [&] {
                std::array<DWORD, 128> members{};
                state.memberCount = GetConsoleProcessList(members.data(), static_cast<DWORD>(members.size()));
                state.memberError = state.memberCount ? ERROR_SUCCESS : GetLastError();
                state.membersKnown = state.memberCount > 0 && state.memberCount <= members.size();
                check(state.membersKnown, "calibration membership was incomplete");
                const auto end = members.begin() + state.memberCount;
                state.controlMember = std::find(members.begin(), end, control.pid) != end;
                state.observerMember = std::find(members.begin(), end, GetCurrentProcessId()) != end;
                check(state.controlMember && state.observerMember,
                      "calibration console membership did not match its owned processes");
            });
            step("calibration-window-sample", [&] {
                state.window = proof::windowFact(GetConsoleWindow());
                check(state.window.metadataKnown && state.window.present && state.window.topLevel &&
                      state.window.visible && state.window.onScreen, "calibration visible console window could not be mapped");
                state.window.received = proof::moment();
                observer.bindControlSample(control.pid, state.window);
            });
            step("calibration-window-events", [&] {
                proof::until([&] {
                    return observer.windowEventSeen(state.window.window, EVENT_OBJECT_CREATE) &&
                        observer.windowEventSeen(state.window.window, EVENT_OBJECT_SHOW) &&
                        observer.passiveVisible(state.window.window, state.begin.tick,
                                                state.beforeAttach.tick + 1, state.beforeAttach.qpc);
                }, "calibration window create/show events were incomplete");
            });
        }
        // Retain the attached host until its queued application-end event is observed.
        step("calibration-control-stop", [&] {
            control.stop();
            if (observer.observesWindows()) observer.confirmControlDeparture(control.pid);
        });
        step("calibration-console-end", [&] {
            proof::until([&] { return observer.console(control.pid, EVENT_CONSOLE_END_APPLICATION); },
                         "observer did not detect console control exit");
            if (observer.observesWindows()) observer.confirmObserverOnly(control.pid);
        });
        step("calibration-detach", [&] {
            const bool detached = FreeConsole() != FALSE;
            state.detachKnown = true;
            state.detachError = detached ? ERROR_SUCCESS : GetLastError();
            if (detached) state.attached = false;
            check(detached, "observer could not detach the calibration console");
            if (observer.observesWindows()) observer.confirmObserverDetached(control.pid);
        });
        if (observer.observesWindows()) step("calibration-window-destroy", [&] {
            proof::until([&] { return observer.windowEventSeen(state.window.window, EVENT_OBJECT_DESTROY); },
                         "calibration window destroy event was incomplete");
        });
        step("calibration-primary-thread-close", [&] {
            const auto error = control.primaryThread.close();
            report << "DIAG control-primary-thread-close error=" << error << "\n";
            check(error == ERROR_SUCCESS, "control primary thread handle close failed");
        });
        const auto end = proof::moment();
        report << "DIAG calibration-complete pid=" << control.pid << " hwnd=" << state.window.window
               << " owner=" << state.window.owner << " kind=" << proof::windowKindName(state.window.kind)
               << " sampled_visible=" << state.window.visible << " sampled_onscreen=" << state.window.onScreen
               << " members=" << state.memberCount << " before_attach_tick=" << state.beforeAttach.tick
               << " before_attach_qpc=" << state.beforeAttach.qpc << " end_tick=" << end.tick
               << " end_qpc=" << end.qpc << " create_observed=1 show_observed=1 destroy_observed=1\n";
        checkpoint("EXIT", "calibration");
        observer.reportBindings(report);
        return state.window;
    } catch (const std::exception& failure) {
        const auto primary = std::current_exception();
        std::vector<std::exception_ptr> secondary;
        bool snapshotComplete = false;
        try {
            reportCalibrationFailure(observer, report, control, state, failure);
            snapshotComplete = true;
        }
        catch (const std::exception&) { secondary.push_back(std::current_exception()); }
        const auto cleanupBegin = GetTickCount64();
        try { control.stop(); }
        catch (const std::exception&) { secondary.push_back(std::current_exception()); }
        const bool detachAttempted = state.attached;
        bool detached = !detachAttempted;
        DWORD detachError = ERROR_SUCCESS;
        if (detachAttempted) {
            detached = FreeConsole() != FALSE;
            if (!detached) {
                detachError = GetLastError();
                secondary.push_back(std::make_exception_ptr(std::runtime_error("calibration cleanup detach failed")));
            }
        }
        const auto primaryClose = control.primaryThread.close();
        if (primaryClose != ERROR_SUCCESS)
            secondary.push_back(std::make_exception_ptr(std::runtime_error("control primary thread handle close failed")));
        report << "DIAG calibration-cleanup control_complete=" << control.cleanup.complete
               << " wait=" << control.cleanup.finalWait << " wait_error=" << control.cleanup.waitError
               << " terminate_attempted=" << control.cleanup.terminationAttempted
               << " terminate_succeeded=" << control.cleanup.terminationSucceeded
               << " terminate_error=" << control.cleanup.terminationError
               << " detach_attempted=" << detachAttempted << " detached=" << detached << " detach_error=" << detachError
               << " primary_thread_close_error=" << primaryClose
               << " secondary_failures=" << secondary.size() << " elapsed_ms=" << GetTickCount64() - cleanupBegin
               << " failure_snapshot_complete=" << snapshotComplete << "\n";
        report.flush();
        throw CalibrationFailure(failureCode(failure), state.stage, primary, std::move(secondary));
    }
}

void failureReportingCases() {
    const std::array<std::pair<std::string, const char*>, 9> cases{{
        { "calibration window create/show events were incomplete", "calibration-window-events-incomplete" },
        { "N1 missing frame was accepted as opened", "n1-missing-frame-accepted" },
        { "F03 pending close lost the startup owner", "n2-pending-owner-lost" },
        { "F01 coordinator created a visible terminal", "n3-visible-coordinator-terminal" },
        { "LC-001 failure rectangle escaped the current monitor work area", "lc001-failure-outside-work-area" },
        { "C:\\private\\foreign-fixture", "unclassified-proof-error" },
        { "foreign-\xce\xa9-payload", "unclassified-proof-error" },
        { std::string(5000, 'x'), "unclassified-proof-error" },
        { "foreign-unknown-payload", "unclassified-proof-error" }
    }};
    for (const auto& [message, code] : cases) {
        const std::runtime_error error(message);
        std::ostringstream output;
        writeFailure(output, error, "failure-envelope-cases");
        check(output.str() == std::string("FAIL code=") + code + " stage=failure-envelope-cases\n",
              "fixed failure envelope differed");
    }
}

void pollingObservationCases() {
    std::ostringstream full;
    PollingObservation nominal(full, "simulated-poll-wait", 0);
    for (uint64_t tick = 0; tick <= 190000; tick += 20) {
        ++nominal.polls;
        nominal.message(WM_GETTEXTLENGTH, true, 0, 0, tick);
        nominal.message(WM_GETTEXT, true, 0, 0, tick);
        nominal.progress(tick);
    }
    nominal.emit("EXIT", 190000);
    const auto text = full.str();
    check(nominal.polls == 9501 && nominal.messages == 19002 && nominal.succeeded == 19002 &&
          nominal.records == 97 && nominal.records <= 128 &&
          static_cast<size_t>(std::count(text.begin(), text.end(), '\n')) == nominal.records,
          "full polling observation lost counts or exceeded its record bound");

    std::ostringstream failed;
    PollingObservation timeout(failed, "simulated-failed-wait", 0);
    ++timeout.polls;
    bool rejected = false;
    try { timeout.message(WM_GETTEXT, false, ERROR_TIMEOUT, 2000, 2000); }
    catch (const WindowMessageFailure& error) {
        rejected = error.message == WM_GETTEXT && error.error == ERROR_TIMEOUT && error.elapsed == 2000;
        timeout.emit("FAIL", 2000);
    }
    check(rejected && timeout.messages == 1 && timeout.succeeded == 0 &&
          failed.str().find("CHECK FAIL window-message scope=simulated-failed-wait message=13 error=1460") != std::string::npos &&
          failed.str().find("CHECK EXIT") == std::string::npos,
          "polling timeout was hidden or appeared successful");

    std::ostringstream slow;
    PollingObservation delayed(slow, "simulated-slow-wait", 0);
    ++delayed.polls;
    delayed.message(WM_GETTEXTLENGTH, true, 0, 200, 200);
    delayed.message(WM_GETTEXT, true, 0, 300, 500);
    delayed.progress(2000);
    delayed.emit("EXIT", 2000);
    check(delayed.slow == 2 && delayed.maximumMessageMs == 300 && delayed.messages == 2 &&
          delayed.succeeded == 2 && slow.str().find("DIAG poll-leaf-slow") != std::string::npos &&
          slow.str().find("slow_messages=2 max_message_ms=300") != std::string::npos,
          "slow polling calls lost their immediate and aggregate evidence");
    check(liveReport != nullptr, "polling case report is missing");
    *liveReport << "DIAG polling-observation-cases cases=3 passed=3 simulated_ms=190000 polls=9501 messages=19002 records=97\n";
    liveReport->flush();
}

void preflight(const fs::path& root, const std::wstring& native) {
    bool rejected = false;
    try { recap::launchPaths(native, L"--unexpected"); }
    catch (const recap::WindowsFailure&) { rejected = true; }
    check(rejected, "native arguments were not rejected");
    check(!recap::insideRoot(L"C:\\fixture", L"C:\\fixture-escape\\node.exe"), "component prefix escaped root");
    check(recap::blockedEnvironment(L"nOdE_oPtIoNs=x") && recap::blockedEnvironment(L"node_path=x") &&
          !recap::blockedEnvironment(L"NODE_EXTRA=x"), "blocked environment names differ");
    check(recap::quoted(L"a b\\") == L"\"a b\\\\\"", "Windows trailing-slash quoting failed");
    const auto data = root / L"preflight";
    fs::create_directories(data / L"runtime" / L"node.exe");
    write(data / L"launcher.exe", "fixture");
    write(data / L"Launcher.mjs", "fixture");
    rejected = false;
    try { recap::launchPaths((data / L"launcher.exe").wstring(), L""); }
    catch (const recap::WindowsFailure&) { rejected = true; }
    check(rejected, "nonregular runtime was accepted");
    fs::remove(data / L"runtime" / L"node.exe");
    write(root / L"outside.exe", "fixture");
    check(CreateSymbolicLinkW((data / L"runtime" / L"node.exe").c_str(), (root / L"outside.exe").c_str(),
          SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE) != FALSE, "reparse proof prerequisite unavailable");
    rejected = false;
    try { recap::launchPaths((data / L"launcher.exe").wstring(), L""); }
    catch (const recap::WindowsFailure&) { rejected = true; }
    check(rejected, "escaping runtime was accepted");
}

RECT positionPendingAtEdge(HWND window) {
    checkpoint("ENTER", "failure-edge-setup");
    MONITORINFO monitor{ sizeof(MONITORINFO) };
    check(GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST), &monitor) != FALSE,
          "failure fixture current work area unavailable");
    const auto dpi = GetDpiForWindow(window);
    const int width = std::min(MulDiv(300, static_cast<int>(dpi), 96),
                               static_cast<int>(monitor.rcWork.right - monitor.rcWork.left));
    const int height = std::min(MulDiv(280, static_cast<int>(dpi), 96),
                                static_cast<int>(monitor.rcWork.bottom - monitor.rcWork.top));
    check(SetWindowPos(window, nullptr, monitor.rcWork.right - width, monitor.rcWork.bottom - height,
                       width, height, SWP_NOZORDER | SWP_NOACTIVATE) != FALSE,
          "pending failure fixture could not be placed near the edge");
    checkpoint("EXIT", "failure-edge-setup");
    return monitor.rcWork;
}

void failureFits(HWND window, const RECT& work) {
    checkpoint("ENTER", "failure-work-area");
    RECT rectangle{};
    check(GetWindowRect(window, &rectangle) != FALSE, "failure rectangle unavailable");
    const auto fits = [&](const RECT& value) {
        return value.left >= work.left && value.top >= work.top && value.right <= work.right &&
            value.bottom <= work.bottom && value.right > value.left && value.bottom > value.top;
    };
    check(fits(rectangle), "LC-001 failure rectangle escaped the current monitor work area");
    for (const int id : { 203, 204 }) {
        RECT control{};
        check(GetWindowRect(GetDlgItem(window, id), &control) != FALSE && fits(control),
              "LC-001 failure control escaped the current monitor work area");
    }
    checkpoint("EXIT", "failure-work-area");
}

void fixture(const std::string& id, const fs::path& root, const fs::path& native,
             const fs::path& runtime, const fs::path& source, proof::Observer& observer,
             std::vector<DWORD>& roots, std::ofstream& report, bool consoleOnly,
             HandleVerdict* diagnosticVerdict = nullptr) {
    checkpoint("ENTER", id.c_str());
    FixtureSetupContext setup{ id };
    const auto layout = root / (id == "F01" ? L"fixture space \u03a9" : fs::path(id).wstring());
    fixtureSetup("fixture-layout", setup, [&] { fs::create_directories(layout / L"runtime"); });
    fixtureSetup("fixture-copy-launcher", setup, [&] { fs::copy_file(native, layout / L"RecapPageLauncher.exe"); });
    if (id != "F04") fixtureSetup("fixture-copy-runtime", setup, [&] { fs::copy_file(runtime, layout / L"runtime" / L"node.exe"); });
    if (id != "F05") fixtureSetup("fixture-copy-coordinator", setup, [&] { fs::copy_file(source, layout / L"Launcher.mjs"); });
    fixtureSetup("fixture-scenario", setup, [&] { write(layout / L"scenario.txt", id); });
    SECURITY_ATTRIBUTES security{ sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE };
    auto sentinelHandle = fixtureSetup("fixture-inheritance-sentinel", setup, [&] {
        recap::Handle value(CreateEventW(&security, TRUE, FALSE, nullptr));
        if (!value) throw std::system_error(static_cast<int>(GetLastError()), std::system_category(), "fixture-sentinel-create");
        return value;
    });
    fixtureSetup("fixture-environment", setup, [&] {
        if (id == "F01") {
            SetEnvironmentVariableW(L"NoDe_OpTiOnS", L"--require missing-native-fixture");
            SetEnvironmentVariableW(L"nOdE_pAtH", L"missing-native-fixture");
        }
    });
    Child gui, coordinator, sentinel;
    fixtureSetup("fixture-gui-create", setup, [&] {
        start(gui, (layout / L"RecapPageLauncher.exe").wstring(), L"", 0, TRUE);
        setup.gui = gui.pid;
    });
    fixtureSetup("fixture-environment-clear", setup, [&] {
        SetEnvironmentVariableW(L"NoDe_OpTiOnS", nullptr);
        SetEnvironmentVariableW(L"nOdE_pAtH", nullptr);
    });
    fixtureSetup("fixture-root-registration", setup, [&] {
        roots.push_back(gui.pid);
        observer.bindRoot(gui.pid, gui.process.get(), gui.primaryThread.get());
    });
    fixtureSetup("fixture-gui-architecture", setup, [&] { proof::nativeArchitecture(gui.process.get()); });
    HWND window = nullptr;
    fixtureSetup("fixture-window-discovery", setup, [&] {
        proof::until([&] { window = windowFor(gui.pid); return window != nullptr; }, "native window did not appear");
    });
    if (id != "F04" && id != "F05") {
        fixtureSetup("fixture-observed-ready", setup, [&] {
            proof::until([&] { return fs::exists(layout / L"observed.txt"); }, "coordinator fixture did not start");
            setup.recordReady = true;
        });
        const auto record = fixtureSetup("fixture-observed-read", setup, [&] { return readFixtureRecord(layout / L"observed.txt", setup); });
        fixtureSetup("fixture-observed-parse", setup, [&] {
            setup.coordinator = parseFixtureRecord(record, FixtureRecordKind::observed);
            setup.recordParsed = true;
        });
        fixtureSetup("fixture-client-retain", setup, [&] {
            retain(coordinator, setup.coordinator, (layout / L"runtime" / L"node.exe").wstring());
            setup.clientRetained = true;
        });
        fixtureSetup("fixture-client-binding", setup, [&] { observer.bindClient(coordinator.pid, coordinator.process.get()); });
        if (id == "F01") {
            const auto fence = GetTickCount64() + 200;
            try {
                proof::until([&] {
                    check(!observer.visibleForProcess(gui.pid), "F01 GUI created a visible terminal");
                    check(!observer.visibleForProcess(coordinator.pid), "F01 coordinator created a visible terminal");
                    return GetTickCount64() >= fence && !observer.pendingTerminalIdentity(gui.pid) &&
                        !observer.pendingTerminalIdentity(coordinator.pid);
                }, "passive F01 observation fence did not complete");
            } catch (const std::exception&) {
                observer.reportClientWindows(report, { gui.pid, coordinator.pid });
                throw;
            }
            const auto verdict = observeSentinel(gui, coordinator, sentinelHandle.get(), report, diagnosticVerdict != nullptr);
            if (diagnosticVerdict) *diagnosticVerdict = verdict;
            else {
                check(verdict != HandleVerdict::inherited, "coordinator inherited the unrelated sentinel");
                check(eventExcluded(verdict), "handle inheritance observation was inconclusive");
            }
            if (!consoleOnly && eventExcluded(verdict)) visual(window, layout, report, observer);
        }
    }
    if (id == "F09" || id == "F10") {
        setup.recordReady = setup.recordParsed = setup.clientRetained = false;
        setup.recordBytes = 0;
        fixtureSetup("fixture-sentinel-ready", setup, [&] {
            proof::until([&] { return fs::exists(layout / L"sentinel.txt"); }, "detached fixture sentinel absent");
            setup.recordReady = true;
        });
        const auto record = fixtureSetup("fixture-sentinel-read", setup, [&] { return readFixtureRecord(layout / L"sentinel.txt", setup); });
        fixtureSetup("fixture-sentinel-parse", setup, [&] {
            setup.sentinel = parseFixtureRecord(record, FixtureRecordKind::sentinel);
            setup.recordParsed = true;
        });
        fixtureSetup("fixture-sentinel-retain", setup, [&] {
            retain(sentinel, setup.sentinel, (layout / L"runtime" / L"node.exe").wstring());
            setup.clientRetained = true;
        });
    }
    RECT failureWork{};
    if (id == "F03" || id == "F07") failureWork = positionPendingAtEdge(window);
    if (id == "F02" || id == "F03") {
        if (id == "F02") PostMessageW(window, WM_SYSCOMMAND, SC_CLOSE, 0);
        else sendChecked(GetDlgItem(window, 203), BM_CLICK);
        proof::until([&] { return !IsWindowVisible(window); }, "pending window did not hide");
        check(gui.exit() == STILL_ACTIVE && coordinator.exit() == STILL_ACTIVE,
              "F03 pending close lost the startup owner");
    }
    if (id == "F11") {
        responsive(window);
        check(gui.exit() == STILL_ACTIVE && coordinator.exit() == STILL_ACTIVE, "EOF completed startup before child exit");
    }
    checkpoint("ENTER", "fixture-handshake");
    write(layout / L"continue.txt", "continue");
    const bool opened = id == "F01" || id == "F02" || id == "F09";
    if (opened) {
        proof::until([&] { return gui.exit() != STILL_ACTIVE; }, "opened fixture did not complete");
        check(gui.exit() == 0, "opened fixture failed");
    } else {
        observedWait("error-feedback-wait", [&] {
            check(gui.exit() == STILL_ACTIVE, id == "F03"
                ? "F03 pending close lost the startup owner" : "failure feedback owner exited early");
            return IsWindowVisible(window) && controlText(GetDlgItem(window, 203)) == L"Close";
        }, "readable error feedback did not appear", id == "F10" ? 190000 : 15000);
        if (id == "F03" || id == "F07") failureFits(window, failureWork);
        accessible(window, true);
        const auto detail = controlText(GetDlgItem(window, 204));
        check(!detail.empty(), "error feedback was empty");
        if (id == "F03") check(detail.find(L"Fixture failure \u03a9.") != std::wstring::npos, "Unicode late error was lost");
        if (id == "F08") check(detail.find(L"Additional diagnostic bytes omitted") != std::wstring::npos, "diagnostic omission was not explicit");
        if (id == "F10") check(detail.find(L"timed out") != std::wstring::npos, "watchdog error was not explicit");
        PostMessageW(window, WM_KEYDOWN, VK_ESCAPE, 0);
        proof::until([&] { return gui.exit() != STILL_ACTIVE; }, "error could not be dismissed");
        check(gui.exit() == 1, "error dismissal did not fail");
    }
    if (sentinel.process) {
        check(sentinel.exit() == STILL_ACTIVE, "detached fixture sentinel was terminated");
        sentinel.stop();
    }
    if (coordinator.process) coordinator.stop();
    checkpoint("EXIT", "fixture-handshake");
    if (diagnosticVerdict)
        report << "HANDLE fixture-handshake=complete exclusion=" << verdictName(*diagnosticVerdict)
               << " visual=" << (eventExcluded(*diagnosticVerdict) ? "passed" : "not-run") << "\n";
    else report << "PASS " << id << "\n";
    checkpoint("EXIT", id.c_str());
}

void handleDiagnostic(const std::map<std::wstring, std::wstring>& options, std::ofstream& report) {
    SYSTEM_INFO host{};
    GetNativeSystemInfo(&host);
    check(host.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_AMD64, "handle diagnostic is x64 only");
    handleClassificationCases();
    uiaOutputCases();
    windowCorrelationCases();
    observed("console-binding-cases", [] { consoleBindingCases(); });
    report << "HANDLE classification-rows=19 passed=19 allocation-order=gui-control-before-original-slot\n";
    proof::Observer observer(true, proof::ObservationProfile::diagnostic);
    size_t controlStarts = 0;
    std::vector<proof::WindowFact> controls{ calibration(observer, report, &controlStarts) };
    std::vector<DWORD> roots;
    HandleVerdict verdict = HandleVerdict::inconclusive;
    fixture("F01", options.at(L"--root"), options.at(L"--launcher"), options.at(L"--runtime"),
            options.at(L"--fixture"), observer, roots, report, false, &verdict);
    controls.push_back(calibration(observer, report, &controlStarts));
    observer.stop();
    observer.assertNoVisibleTerminals(roots, controls, report);
    observer.finishIdentities();
    report << "HANDLE acquisition=complete exclusion=" << verdictName(verdict)
           << " gui-activations=" << roots.size() << " calibration-controls=" << controlStarts
           << " observer-healthy=" << observer.healthy() << " clock-valid=" << observer.clockValid()
           << " etw-losses=" << observer.eventsLost() << " cleanup=complete\n";
    check(eventExcluded(verdict), "focused handle exclusion remains inconclusive or inherited");
    report << "PASS focused-handle-diagnostic;feature-acceptance=not-evaluated\n";
}

uint64_t creationTime(HANDLE process) {
    FILETIME created{}, exited{}, kernel{}, user{};
    check(GetProcessTimes(process, &created, &exited, &kernel, &user) != FALSE,
          "owned process creation identity unavailable");
    return (static_cast<uint64_t>(created.dwHighDateTime) << 32) | created.dwLowDateTime;
}

struct AttachmentFact {
    bool attempted = false, detachBefore = false, attached = false, detachAfter = false;
    bool liveBefore = false, liveAfter = false, membershipKnown = false, complete = false;
    DWORD detachBeforeError = 0, attachError = 0, detachAfterError = 0, membershipError = 0;
    DWORD memberCount = 0;
    std::array<DWORD, 128> members{};
    proof::Moment begin, beforeAttach, afterAttach, end;
    proof::WindowFact associated;
};

AttachmentFact attachment(Child& target) {
    AttachmentFact fact;
    fact.attempted = true;
    fact.begin = proof::moment();
    fact.liveBefore = target.exit() == STILL_ACTIVE;
    fact.detachBefore = FreeConsole() != FALSE;
    if (!fact.detachBefore) fact.detachBeforeError = GetLastError();
    fact.beforeAttach = proof::moment();
    if (fact.liveBefore && fact.detachBefore) {
        fact.attached = AttachConsole(target.pid) != FALSE;
        if (!fact.attached) fact.attachError = GetLastError();
    }
    fact.afterAttach = proof::moment();
    if (fact.attached) {
        fact.memberCount = GetConsoleProcessList(fact.members.data(), static_cast<DWORD>(fact.members.size()));
        if (!fact.memberCount) fact.membershipError = GetLastError();
        fact.membershipKnown = fact.memberCount > 0 && fact.memberCount <= fact.members.size();
        fact.associated = proof::windowFact(GetConsoleWindow());
        fact.detachAfter = FreeConsole() != FALSE;
        if (!fact.detachAfter) fact.detachAfterError = GetLastError();
    }
    fact.end = proof::moment();
    fact.liveAfter = target.exit() == STILL_ACTIVE;
    const auto membersEnd = fact.members.begin() + std::min<size_t>(fact.memberCount, fact.members.size());
    const bool targetMember = std::find(fact.members.begin(), membersEnd, target.pid) != membersEnd;
    const bool observerMember = std::find(fact.members.begin(), membersEnd, GetCurrentProcessId()) != membersEnd;
    fact.complete = fact.liveBefore && fact.liveAfter && fact.detachBefore &&
        (fact.attached
            ? fact.detachAfter && fact.membershipKnown && targetMember && observerMember &&
              (!fact.associated.window || fact.associated.metadataKnown)
            : fact.attachError == ERROR_INVALID_HANDLE);
    return fact;
}

struct DiagnosticCase {
    std::string id, error;
    DWORD gui = 0, coordinator = 0;
    uint64_t guiCreated = 0, coordinatorCreated = 0;
    proof::Moment begin, beforeIntervention, end;
    AttachmentFact guiAttachment, coordinatorAttachment;
    StopResult guiCleanup, coordinatorCleanup;
    bool acquired = false, cleanup = false, lineage = false;
};

std::string safeDiagnosticError(const std::exception& error) {
    const std::string text(error.what());
    if (text.size() <= 200 && std::all_of(text.begin(), text.end(), [](unsigned char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == ' ' || c == '.' || c == '_' || c == '-' || c == '=';
    })) return text;
    return "native diagnostic acquisition failed with an unprintable detail";
}

DiagnosticCase diagnosticCase(const std::string& id, const fs::path& root, const fs::path& launcher,
                              const fs::path& runtime, const fs::path& source, proof::Observer& observer) {
    DiagnosticCase result;
    result.id = id;
    FixtureSetupContext setup{ id };
    const auto layout = root / (fs::path(id).wstring() + L" space \u03a9");
    Child gui, coordinator;
    try {
        fs::create_directories(layout / L"runtime");
        fs::copy_file(launcher, layout / L"RecapPageLauncher.exe");
        fs::copy_file(runtime, layout / L"runtime" / L"node.exe");
        fs::copy_file(source, layout / L"Launcher.mjs");
        write(layout / L"scenario.txt", "F01");
        result.begin = proof::moment();
        start(gui, (layout / L"RecapPageLauncher.exe").wstring(), L"", 0);
        setup.gui = gui.pid;
        result.gui = gui.pid;
        result.guiCreated = creationTime(gui.process.get());
        observer.bindRoot(gui.pid, gui.process.get());
        proof::nativeArchitecture(gui.process.get());
        proof::until([&] { return windowFor(gui.pid) != nullptr; }, "diagnostic GUI window was not observed");
        proof::until([&] { return fs::exists(layout / L"observed.txt"); }, "diagnostic coordinator did not start");
        setup.recordReady = true;
        const auto record = fixtureSetup("fixture-diagnostic-record-read", setup, [&] {
            return readFixtureRecord(layout / L"observed.txt", setup);
        });
        fixtureSetup("fixture-diagnostic-record-parse", setup, [&] {
            setup.coordinator = parseFixtureRecord(record, FixtureRecordKind::observed);
            setup.recordParsed = true;
        });
        fixtureSetup("fixture-diagnostic-client-retain", setup, [&] {
            retain(coordinator, setup.coordinator, (layout / L"runtime" / L"node.exe").wstring());
            setup.clientRetained = true;
        });
        result.coordinator = coordinator.pid;
        result.coordinatorCreated = creationTime(coordinator.process.get());
        const auto passiveFence = GetTickCount64() + 200;
        proof::until([&] {
            check(gui.exit() == STILL_ACTIVE && coordinator.exit() == STILL_ACTIVE,
                  "diagnostic target exited during passive observation");
            return GetTickCount64() >= passiveFence;
        }, "passive observation fence did not finish");
        result.beforeIntervention = proof::moment();
        if (id != "D1") {
            result.guiAttachment = attachment(gui);
            result.coordinatorAttachment = attachment(coordinator);
            check(result.guiAttachment.complete && result.coordinatorAttachment.complete,
                  "attachment observation was incomplete");
            check(creationTime(gui.process.get()) == result.guiCreated &&
                  creationTime(coordinator.process.get()) == result.coordinatorCreated,
                  "attachment target creation identity changed");
        }
        write(layout / L"continue.txt", "continue");
        proof::until([&] { return gui.completed() && coordinator.completed(); },
                     "diagnostic handshake did not finish");
        check(gui.exit() == 0 && coordinator.exit() == 0, "diagnostic handshake returned failure");
        result.acquired = true;
    } catch (const std::exception& error) {
        result.error = safeDiagnosticError(error);
    }
    result.cleanup = (id == "D1" || FreeConsole() != FALSE) && (!gui.pid || coordinator.pid != 0);
    if (!result.cleanup) result.error = "diagnostic process ownership or detach cleanup was incomplete";
    for (auto* child : { &coordinator, &gui }) {
        try { child->stop(); }
        catch (const std::exception& error) {
            result.cleanup = false;
            result.error = safeDiagnosticError(error);
        }
    }
    result.guiCleanup = gui.cleanup;
    result.coordinatorCleanup = coordinator.cleanup;
    result.end = proof::moment();
    return result;
}

void reportAttachment(std::ofstream& report, const DiagnosticCase& item, const char* role,
                      DWORD pid, const AttachmentFact& fact) {
    report << "DIAG attachment case=" << item.id << " role=" << role << " pid=" << pid
           << " attempted=" << fact.attempted << " complete=" << fact.complete
           << " begin_tick=" << fact.begin.tick << " before_attach_tick=" << fact.beforeAttach.tick
           << " after_attach_tick=" << fact.afterAttach.tick << " end_tick=" << fact.end.tick
           << " begin_qpc=" << fact.begin.qpc << " end_qpc=" << fact.end.qpc
           << " live_before=" << fact.liveBefore << " live_after=" << fact.liveAfter
           << " detach_before=" << fact.detachBefore << " detach_before_error=" << fact.detachBeforeError
           << " attach=" << fact.attached << " attach_error=" << fact.attachError
           << " detach_after=" << fact.detachAfter << " detach_after_error=" << fact.detachAfterError
           << " member_count=" << fact.memberCount << " membership_known=" << fact.membershipKnown
           << " membership_error=" << fact.membershipError
           << " associated_hwnd=" << fact.associated.window << " associated_owner=" << fact.associated.owner
           << " associated_kind=" << proof::windowKindName(fact.associated.kind)
           << " associated_metadata=" << fact.associated.metadataKnown
           << " associated_present=" << fact.associated.present << " associated_visible=" << fact.associated.visible
           << " associated_onscreen=" << fact.associated.onScreen << " members=";
    for (size_t index = 0; index < std::min<size_t>(fact.memberCount, fact.members.size()); ++index)
        report << (index ? "," : "") << fact.members[index];
    report << "\n";
}

void diagnostic(const std::map<std::wstring, std::wstring>& options, std::ofstream& report) {
    SYSTEM_INFO host{};
    GetNativeSystemInfo(&host);
    check(host.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_AMD64,
          "diagnostic mode is restricted to the x64 host");
    const auto& hash = options.at(L"--runtime-hash");
    check(hash.size() == 64 && std::all_of(hash.begin(), hash.end(), [](wchar_t c) {
        return (c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f');
    }), "diagnostic runtime hash missing");
    const auto& version = options.at(L"--runtime-version");
    check(version.size() < 32 && !version.empty() && std::all_of(version.begin(), version.end(), [](wchar_t c) {
        return (c >= L'0' && c <= L'9') || c == L'v' || c == L'.';
    }), "diagnostic runtime version missing");
    report << "DIAG runtime version=";
    for (const auto c : version) report << static_cast<char>(c);
    report << " sha256=";
    for (const auto c : hash) report << static_cast<char>(c);
    report << " architecture=x64 cases=3 mutation=N3\n";
    proof::Observer observer(true, proof::ObservationProfile::diagnostic);
    std::vector<proof::WindowFact> controls;
    size_t controlStarts = 0;
    std::vector<DiagnosticCase> cases;
    std::string acquisitionFailure;
    try {
        controls.push_back(calibration(observer, report, &controlStarts));
        for (const auto* id : { "D1", "D2", "D3" }) {
            cases.push_back(diagnosticCase(id, options.at(L"--root"),
                options.at(std::string(id) == "D3" ? L"--mutant" : L"--launcher"),
                options.at(L"--runtime"), options.at(L"--fixture"), observer));
            const auto& observed = cases.back();
            report << "DIAG lifecycle case=" << id << " gui_pid=" << observed.gui
                   << " coordinator_pid=" << observed.coordinator << " acquired=" << observed.acquired
                   << " cleanup=" << observed.cleanup << "\n";
            report.flush();
            check(observed.cleanup, "diagnostic owned cleanup could not be confirmed");
        }
        controls.push_back(calibration(observer, report, &controlStarts));
    } catch (const std::exception& error) {
        acquisitionFailure = safeDiagnosticError(error);
    }
    observer.stop();
    const auto processes = observer.processes();
    bool complete = observer.healthy() && observer.clockValid() && acquisitionFailure.empty() &&
        cases.size() == 3 && controls.size() == 2;
    report << "DIAG clocks window=uptime-ms process=raw-qpc creation=filetime-100ns qpc_frequency="
           << observer.frequency() << " observer_pid=" << GetCurrentProcessId() << "\n";
    for (auto& item : cases) {
        const auto startFor = [&](DWORD pid, DWORD parent) {
            return std::count_if(processes.begin(), processes.end(), [&](const auto& process) {
                return process.start && process.pid == pid && process.parent == parent &&
                    process.timestamp >= static_cast<LONGLONG>(item.begin.qpc) &&
                    process.timestamp <= static_cast<LONGLONG>(item.end.qpc);
            }) == 1;
        };
        const auto ended = [&](DWORD pid) {
            return std::count_if(processes.begin(), processes.end(), [&](const auto& process) {
                return !process.start && process.pid == pid && process.exitKnown && process.exitCode == 0 &&
                    process.timestamp >= static_cast<LONGLONG>(item.begin.qpc) &&
                    process.timestamp <= static_cast<LONGLONG>(item.end.qpc);
            }) == 1;
        };
        item.lineage = startFor(item.gui, GetCurrentProcessId()) &&
            startFor(item.coordinator, item.gui) && ended(item.gui) && ended(item.coordinator);
        for (const auto& process : processes) {
            if (process.pid != item.gui && process.pid != item.coordinator) continue;
            report << "DIAG process case=" << item.id << " role=" << (process.pid == item.gui ? "gui" : "coordinator")
                   << " pid=" << process.pid << " parent=" << process.parent << " start=" << process.start
                   << " timestamp_qpc=" << process.timestamp << " exit_known=" << process.exitKnown
                   << " exit_code=" << process.exitCode << "\n";
        }
        report << "DIAG case=" << item.id << " acquired=" << item.acquired << " cleanup=" << item.cleanup
               << " lineage=" << item.lineage << " gui_pid=" << item.gui << " coordinator_pid=" << item.coordinator
               << " gui_creation=" << item.guiCreated << " coordinator_creation=" << item.coordinatorCreated
               << " begin_tick=" << item.begin.tick << " begin_qpc=" << item.begin.qpc
               << " intervention_tick=" << item.beforeIntervention.tick
               << " intervention_qpc=" << item.beforeIntervention.qpc
               << " end_tick=" << item.end.tick << " end_qpc=" << item.end.qpc
               << " error=" << (item.error.empty() ? "none" : item.error) << "\n";
        for (const auto& cleanup : std::vector<std::pair<const char*, StopResult>>{
            { "gui", item.guiCleanup }, { "coordinator", item.coordinatorCleanup }
        }) {
            report << "DIAG cleanup case=" << item.id << " role=" << cleanup.first
                   << " complete=" << cleanup.second.complete << " initial_wait=" << cleanup.second.initialWait
                   << " final_wait=" << cleanup.second.finalWait << " wait_error=" << cleanup.second.waitError
                   << " terminate_attempted=" << cleanup.second.terminationAttempted
                   << " terminate_succeeded=" << cleanup.second.terminationSucceeded
                   << " terminate_error=" << cleanup.second.terminationError << "\n";
        }
        reportAttachment(report, item, "gui", item.gui, item.guiAttachment);
        reportAttachment(report, item, "coordinator", item.coordinator, item.coordinatorAttachment);
        std::set<uintptr_t> associated;
        for (const auto& probe : { item.guiAttachment, item.coordinatorAttachment })
            if (probe.attached && probe.complete && probe.associated.window) associated.insert(probe.associated.window);
        for (const auto& event : observer.consoles()) {
            if (event.pid != item.gui && event.pid != item.coordinator) continue;
            if (event.generated < item.begin.tick || event.generated > item.end.tick) continue;
            if (event.window) associated.insert(event.window);
            report << "DIAG console case=" << item.id << " event=" << event.event << " pid=" << event.pid
                   << " hwnd=" << event.window << " child=" << event.child << " source_thread=" << event.sourceThread
                   << " generation32=" << event.generated32 << " generation_tick=" << event.generated
                   << " receipt_tick=" << event.received.tick << " receipt_qpc=" << event.received.qpc << "\n";
        }
        std::set<std::pair<uintptr_t, DWORD>> passive, intervention, unmapped;
        size_t unknown = 0, emitted = 0, omitted = 0;
        for (const auto& fact : observer.windows()) {
            if (fact.generated < item.begin.tick || fact.generated > item.end.tick) continue;
            const bool control = std::any_of(controls.begin(), controls.end(), [&](const auto& known) {
                return fact.window == known.window && fact.owner == known.owner;
            });
            if (control) continue;
            if (!fact.metadataKnown) ++unknown;
            const bool terminal = associated.count(fact.window) ||
                fact.kind == proof::WindowKind::console || fact.kind == proof::WindowKind::terminal;
            const bool visible = terminal && proof::visibleIn(fact, item.begin.tick, item.end.tick + 1);
            const bool mapped = associated.count(fact.window) || fact.owner == item.gui || fact.owner == item.coordinator;
            if (visible) {
                const auto identity = std::make_pair(fact.window, fact.owner);
                if (!mapped) unmapped.insert(identity);
                if (item.id == "D1" || fact.generated < item.beforeIntervention.tick ||
                    (fact.generated == item.beforeIntervention.tick && fact.received.qpc < item.beforeIntervention.qpc))
                    passive.insert(identity);
                else intervention.insert(identity);
            }
            if (!terminal && fact.kind != proof::WindowKind::startup && fact.metadataKnown) continue;
            if (emitted >= 64) { ++omitted; continue; }
            ++emitted;
            report << "DIAG window case=" << item.id << " kind=" << proof::windowKindName(fact.kind)
                   << " event=" << fact.event << " hwnd=" << fact.window << " owner=" << fact.owner
                   << " object=" << fact.object << " child=" << fact.child << " thread=" << fact.thread
                   << " source_thread=" << fact.sourceThread << " generation32=" << fact.generated32
                   << " generation_tick=" << fact.generated << " receipt_tick=" << fact.received.tick
                   << " receipt_qpc=" << fact.received.qpc << " metadata=" << fact.metadataKnown
                   << " present=" << fact.present << " visible_now=" << fact.visible
                   << " top=" << fact.topLevel << " onscreen=" << fact.onScreen
                   << " left=" << fact.rectangle.left << " top_px=" << fact.rectangle.top
                   << " right=" << fact.rectangle.right << " bottom=" << fact.rectangle.bottom << "\n";
        }
        const bool quality = item.acquired && item.cleanup && item.lineage && !unknown && unmapped.empty();
        const bool negative = item.id != "D3" || !passive.empty();
        complete = complete && quality && negative;
        report << "DIAG result case=" << item.id << " passive_visible_terminals=" << passive.size()
               << " intervention_visible_terminals=" << intervention.size() << " unmapped_terminals=" << unmapped.size()
               << " unknown_window_records=" << unknown << " omitted_window_rows=" << omitted
               << " complete=" << quality << " required_negative_observed=" << negative << "\n";
    }
    report << "DIAG observer healthy=" << observer.healthy() << " clock_valid=" << observer.clockValid()
           << " etw_events_lost=" << observer.eventsLost() << " etw_buffers_lost=" << observer.buffersLost()
           << " process_records=" << processes.size()
           << " console_records=" << observer.consoles().size() << " window_records=" << observer.windows().size()
           << " calibration_starts=" << controlStarts << " calibration_complete=" << controls.size()
           << " acquisition_error=" << (acquisitionFailure.empty() ? "none" : acquisitionFailure) << "\n";
    check(complete, "diagnostic acquisition was incomplete or the visible negative was not observed");
    report << "PASS diagnostic-facts-only;feature-acceptance=not-evaluated\n";
    observer.finishIdentities();
}

void installed(const std::map<std::wstring, std::wstring>& options, std::ofstream& report) {
    wchar_t hosted[16]{};
    GetEnvironmentVariableW(L"GITHUB_ACTIONS", hosted, static_cast<DWORD>(std::size(hosted)));
    check(wcscmp(hosted, L"true") == 0, "installed observation is hosted-only");
    const fs::path control(options.at(L"--root"));
    const fs::path package(options.at(L"--installed-root"));
    const auto executable = (package / L"RecapPageLauncher.exe").wstring();
    check(package.wstring().find(L"\\WindowsApps\\PanelStackLabs.RecapPage_") != std::wstring::npos &&
          package.wstring().find(L"__we33aa8nvkpcc") != std::wstring::npos,
          "installed observation requires the exact package family");
    const bool busy = options.at(L"--mode") == L"busy";
    proof::Observer observer(true, busy ? proof::ObservationProfile::installedBusy : proof::ObservationProfile::installedFunctionality);
    observer.reportTo(report);
    observed("semantic-caller-bind", [&] { bindSemanticCaller(observer, control, options.at(L"--mode")); });
    observer.watchRootImage(executable);
    std::vector<proof::WindowFact> controls{ calibration(observer, report) };
    write(control / L"ready.txt", "ready");
    bool dismissed = false;
    size_t operationOrdinal = 1;
    bool operationActive = false;
    observedWait("installed-result-wait", [&] {
        collectSemanticOperations(observer, control, operationOrdinal, operationActive);
        const auto counts = observer.entryCounts(executable);
        write(control / L"counts.txt", "started=" + std::to_string(counts.first) +
              "\nended=" + std::to_string(counts.second) + "\n");
        if (busy && !dismissed) {
            const auto events = observer.processes();
            for (const auto& event : events) {
                if (!event.start) continue;
                const HWND window = windowFor(event.pid);
                if (!window || controlText(GetDlgItem(window, 203)) != L"Close") continue;
                Child gui;
                retain(gui, event.pid, executable);
                observer.bindRoot(gui.pid, gui.process.get());
                accessible(window, true);
                const auto detail = controlText(GetDlgItem(window, 204));
                for (const auto* required : {
                    L"Port 8787 is already in use.", L"It is not running this version of Recap Page.",
                    L"Do not start Recap Page on a different port.",
                    L"another port opens a separate browser storage location.", L"http://127.0.0.1:8787/"
                }) check(detail.find(required) != std::wstring::npos, "installed native guidance was incomplete");
                sendChecked(GetDlgItem(window, 203), BM_CLICK);
                proof::until([&] { return gui.exit() != STILL_ACTIVE; }, "installed error was not dismissible");
                check(gui.exit() == 1, "installed native error exited successfully");
                dismissed = true;
                write(control / L"dismissed.txt", "dismissed");
                break;
            }
        }
        return busy ? dismissed : fs::exists(control / L"finish.txt");
    }, "installed observer deadline exceeded", 600000);
    observed("semantic-channel-drain", [&] {
        proof::until([&] {
            collectSemanticOperations(observer, control, operationOrdinal, operationActive);
            const auto finished = control / L"semantic-finished.txt";
            return !operationActive && fs::exists(finished) && readSemanticRecord(finished) == "finished";
        }, "semantic channel did not finish", 10000);
    });
    controls.push_back(calibration(observer, report));
    observer.stop();
    const auto roots = observer.registeredRoots(executable, busy ? 1 : 3, busy ? 1 : 0);
    observer.assertNoVisibleTerminals(roots, controls, report);
    observer.finishIdentities();
    report << "PASS installed-" << (busy ? "busy" : "functionality")
           << ";native-roots=" << roots.size() << ";console-controls=2;visible-product-terminals=0"
           << ";console-records=" << observer.consoles().size()
           << ";window-records=" << observer.windows().size() << ";attachment=not-used\n";
}
} // namespace

int wmain(int argc, wchar_t** argv) {
    wchar_t hosted[16]{};
    GetEnvironmentVariableW(L"GITHUB_ACTIONS", hosted, static_cast<DWORD>(std::size(hosted)));
    if (wcscmp(hosted, L"true") != 0) return 2;
    DWORD session = 0;
    if (!ProcessIdToSessionId(GetCurrentProcessId(), &session) || session == 0) return 2;
    if (argc == 2 && std::wstring(argv[1]) == L"--console-control") {
        Sleep(INFINITE);
        return 0;
    }
    if (argc == 2 && std::wstring(argv[1]) == L"--health-writer") {
        Sleep(INFINITE);
        return 0;
    }
    std::map<std::wstring, std::wstring> options;
    for (int index = 1; index + 1 < argc; index += 2) options[argv[index]] = argv[index + 1];
    const auto reportPath = fs::path(options[L"--report"]);
    std::ofstream report(reportPath, std::ios::binary | std::ios::app);
    liveReport = &report;
    liveReportPath = reportPath;
    const auto com = observed("com-initialize", [] { return CoInitializeEx(nullptr, COINIT_MULTITHREADED); });
    try {
        check(static_cast<bool>(report), "proof report path is required");
        check(SUCCEEDED(com), "proof COM initialization failed");
        proof::nativeArchitecture(GetCurrentProcess());
        check(observed("proof-dpi-awareness", [] {
            return SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) != nullptr;
        }), "proof DPI context unavailable");
        if (options[L"--mode"] == L"visual-worker") {
            checkpoint("ENTER", "visual-target-validation");
            const auto pid = static_cast<DWORD>(std::stoul(options[L"--target-pid"]));
            const auto window = reinterpret_cast<HWND>(static_cast<uintptr_t>(std::stoull(options[L"--target-window"])));
            recap::Handle target(OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid));
            check(static_cast<bool>(target), "visual worker target handle unavailable");
            check(recap::samePath(proof::imagePath(target.get()),
                  (fs::path(options[L"--root"]) / L"RecapPageLauncher.exe").wstring()),
                  "visual worker target image differed");
            DWORD windowOwner = 0;
            check(GetWindowThreadProcessId(window, &windowOwner) != 0 && windowOwner == pid,
                  "visual worker target identity differed");
            checkpoint("EXIT", "visual-target-validation");
            observed("visual-operation", [&] { visualOperation(window, options[L"--root"], report); });
            observed("com-uninitialize", [] { CoUninitialize(); });
            return 0;
        }
        if (options.count(L"--containment-go")) {
            checkpoint("ENTER", "containment-ready");
            const fs::path go(options[L"--containment-go"]);
            proof::until([&] { return fs::exists(go); }, "fixture containment was not established", 5000);
            BOOL contained = FALSE;
            check(IsProcessInJob(GetCurrentProcess(), nullptr, &contained) && contained, "fixture process is not contained");
            checkpoint("EXIT", "containment-ready");
        } else {
            check(options[L"--mode"] == L"functionality" || options[L"--mode"] == L"busy",
                  "fixture execution requires owned containment");
        }
        if (options[L"--mode"] == L"wrapper-stall") {
            checkpoint("ENTER", "wrapper-health-stall");
            Sleep(INFINITE);
        }
        if (options[L"--mode"] == L"wrapper-held-writer") {
            checkpoint("ENTER", "wrapper-health-held-writer");
            Child writer;
            start(writer, recap::modulePath(), L"--health-writer", CREATE_NO_WINDOW, TRUE);
            check(writer.process.close() == ERROR_SUCCESS, "health writer handle release failed");
            proof::until([&] { return fs::exists(options[L"--progress-ack"]); },
                         "held-writer progress was not surfaced before exit", 1000);
            checkpoint("EXIT", "wrapper-health-held-writer");
            observed("com-uninitialize", [] { CoUninitialize(); });
            return 0;
        }
        if (options[L"--mode"] == L"diagnostic") {
            cleanupCases();
            report << "DIAG deterministic-cleanup-rows=6 passed=6\n";
            diagnostic(options, report);
            observed("com-uninitialize", [] { CoUninitialize(); });
            return 0;
        }
        if (options[L"--mode"] == L"handles") {
            handleDiagnostic(options, report);
            observed("com-uninitialize", [] { CoUninitialize(); });
            return 0;
        }
        if (options[L"--mode"] == L"functionality" || options[L"--mode"] == L"busy") {
            installed(options, report);
            observed("com-uninitialize", [] { CoUninitialize(); });
            return 0;
        }
        if (options[L"--mode"] == L"calibration") {
            SYSTEM_INFO host{};
            GetNativeSystemInfo(&host);
            check(host.wProcessorArchitecture == PROCESSOR_ARCHITECTURE_AMD64, "calibration preflight is x64 only");
            observed("failure-envelope-cases", [] { failureReportingCases(); });
            report << "DIAG failure-envelope-cases cases=9 passed=9\n";
            observed("polling-observation-cases", [] { pollingObservationCases(); });
            observed("final-observer-cases", [] { finalObserverCases(); });
            observed("observation-profile-cases", [] { observationProfileCases(); });
            observed("source-lifetime-cases", [] { sourceLifetimeCases(); });
            observed("semantic-evidence-cases", [] { semanticEvidenceCases(); });
            observed("fixture-record-cases", [] { fixtureRecordCases(); });
            proof::Observer observer(true, proof::ObservationProfile::calibration);
            size_t started = 0;
            windowCorrelationCases();
            observed("console-binding-cases", [] { consoleBindingCases(); });
            std::vector<proof::WindowFact> controls{ calibration(observer, report, &started) };
            controls.push_back(calibration(observer, report, &started));
            observer.stop();
            observer.assertHealthy();
            check(started == 2 && observer.clockValid(), "calibration preflight was incomplete");
            observer.assertCalibrations(controls, report);
            observer.finishIdentities();
            report << "PASS calibration-preflight;controls=2;product-starts=0;node-starts=0\n";
            observed("com-uninitialize", [] { CoUninitialize(); });
            return 0;
        }
        const bool onlyDecoder = options[L"--case"] == L"N1";
        decoder(fs::path(options[L"--goldens"]), onlyDecoder);
        if (onlyDecoder) { report << "PASS N1 baseline\n"; observed("com-uninitialize", [] { CoUninitialize(); }); return 0; }
        supervision();
        const fs::path root(options[L"--root"]);
        fs::create_directories(root);
        preflight(root, options[L"--launcher"]);
        proof::Observer observer(true, proof::ObservationProfile::nativeFixture, verifyFixedFixture(options[L"--fixture"]));
        std::vector<proof::WindowFact> controls{ calibration(observer, report) };
        std::vector<DWORD> roots;
        const std::wstring only = options[L"--case"];
        for (int index = 1; index <= 11; ++index) {
            const auto id = std::string("F") + (index < 10 ? "0" : "") + std::to_string(index);
            if (!only.empty() && only != std::wstring(id.begin(), id.end())) continue;
            fixture(id, root, options[L"--launcher"], options[L"--runtime"], options[L"--fixture"],
                    observer, roots, report, options[L"--console-only"] == L"true");
        }
        controls.push_back(calibration(observer, report));
        observer.stop();
        observer.assertNoVisibleTerminals(roots, controls, report);
        observer.finishIdentities();
        report << "PASS observer;console-controls=2;visible-product-terminals=0;attachment=not-used\n";
        observed("com-uninitialize", [] { CoUninitialize(); });
        return 0;
    } catch (const std::exception& failure) {
        const auto* calibrationFailure = dynamic_cast<const CalibrationFailure*>(&failure);
        const auto* finalFailure = dynamic_cast<const proof::FinalObservationFailure*>(&failure);
        const auto* setupFailure = dynamic_cast<const FixtureSetupFailure*>(&failure);
        writeFailure(report, failure, setupFailure ? setupFailure->stage : finalFailure ? finalFailure->stage :
                     calibrationFailure ? calibrationFailure->stage : lastStage);
        if (SUCCEEDED(com)) observed("com-uninitialize", [] { CoUninitialize(); });
        return 1;
    }
}
