#pragma once

#include "StartupProcess.h"
#include <objbase.h>
#include <evntrace.h>
#include <evntcons.h>
#include <tdh.h>
#include <atomic>
#include <climits>
#include <cstring>
#include <map>
#include <memory>
#include <ostream>
#include <mutex>
#include <set>
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
    check(QueryFullProcessImageNameW(process, 0, buffer.data(), &size) != FALSE, "process image could not be observed");
    return recap::normalizedPath({ buffer.data(), size });
}

inline void nativeArchitecture(HANDLE process) {
    USHORT emulated = 0, native = 0;
    check(IsWow64Process2(process, &emulated, &native) != FALSE, "native architecture could not be observed");
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

struct ProcessEvent {
    DWORD pid = 0, parent = 0;
    bool start = false;
    LONGLONG timestamp = 0;
    std::wstring image, command;
    bool exitKnown = false;
    DWORD exitCode = 0;
};

struct Moment {
    uint64_t tick = 0, qpc = 0;
};

inline Moment moment() {
    LARGE_INTEGER counter{};
    check(QueryPerformanceCounter(&counter) != FALSE, "performance clock unavailable");
    return { GetTickCount64(), static_cast<uint64_t>(counter.QuadPart) };
}

enum class WindowKind { unknown, other, startup, console, terminal };

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
    RECT rectangle{};
};

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
    const char* reason = "missing-identity";
};

inline std::vector<WindowResolution> correlateWindows(const std::vector<WindowFact>& facts,
                                                      bool clocks, bool captureHealthy) {
    struct Lifetime {
        std::vector<size_t> rows;
        bool created = false, closed = false, conflict = false;
    };
    std::vector<Lifetime> lifetimes;
    std::map<uintptr_t, size_t> active;
    std::vector<WindowResolution> result(facts.size());
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
        result[index].lifetime = found->second + 1;
        if (fact.event == EVENT_OBJECT_DESTROY) {
            lifetime.closed = true;
            active.erase(found);
        }
    }
    for (const auto& lifetime : lifetimes) {
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

struct ConsoleFact {
    DWORD event = 0, pid = 0, sourceThread = 0, generated32 = 0;
    LONG child = 0;
    uintptr_t window = 0;
    uint64_t generated = 0;
    Moment received;
};

class Observer {
    struct ProcessCapture {
        std::mutex mutex_;
        std::vector<ProcessEvent> processes_;
        std::map<DWORD, std::wstring> images_;
        std::atomic<bool> lost_{ false };
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
    std::map<DWORD, std::wstring>& images_ = capture_->images_;
    std::vector<ConsoleFact> consoles_;
    std::vector<WindowFact> windows_;
    std::map<DWORD, std::wstring> roots_;
    std::atomic<bool>& lost_ = capture_->lost_;
    std::atomic<bool> clockValid_{ true };
    bool stopped_ = false;
    bool windowObservation_ = false;
    uint64_t frequency_ = 0;

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
        try {
            const auto pidBytes = property(event, L"ProcessId");
            if (pidBytes.size() != sizeof(DWORD)) return;
            const DWORD pid = number(pidBytes);
            const auto parentBytes = property(event, L"ParentId");
            std::lock_guard<std::mutex> lock(self->mutex_);
            if (parentBytes.size() == sizeof(DWORD) &&
                (event->EventHeader.EventDescriptor.Opcode == EVENT_TRACE_TYPE_START ||
                 event->EventHeader.EventDescriptor.Opcode == EVENT_TRACE_TYPE_END)) {
                check(self->processes_.size() < 8192, "ETW process bound exceeded");
                const auto exit = property(event, L"ExitStatus");
                self->processes_.push_back({
                    pid, number(parentBytes), event->EventHeader.EventDescriptor.Opcode == EVENT_TRACE_TYPE_START,
                    event->EventHeader.TimeStamp.QuadPart,
                    narrow(property(event, L"ImageFileName")), wide(property(event, L"CommandLine")),
                    exit.size() == sizeof(DWORD), number(exit)
                });
            } else {
                const auto image = wide(property(event, L"FileName"));
                if (image.size() >= 4 && recap::samePath(image.substr(image.size() - 4), L".exe")) {
                    check(self->images_.size() < 4096, "ETW image bound exceeded");
                    self->images_[pid] = image;
                }
            }
        } catch (const std::exception&) {
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
            current_->consoles_.push_back({
                event, static_cast<DWORD>(object), thread, generated, child,
                reinterpret_cast<uintptr_t>(window), current_->eventTick(generated, received), received
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
            if (thread) {
                recap::Handle source(OpenThread(THREAD_QUERY_LIMITED_INFORMATION, FALSE, thread));
                if (source) fact.sourceOwner = GetProcessIdOfThread(source.get());
                if (!source || !fact.sourceOwner) fact.sourceError = GetLastError();
            }
            fact.generated32 = generated;
            fact.received = moment();
            fact.generated = current_->eventTick(generated, fact.received);
            check(current_->windows_.size() < 8192, "window observation bound exceeded");
            current_->windows_.push_back(fact);
        } catch (const std::exception&) { current_->lost_.store(true); }
    }
public:
    explicit Observer(bool observeWindows = false) : windowObservation_(observeWindows) {
        check(current_ == nullptr, "observer already active");
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
        settings->EnableFlags = EVENT_TRACE_FLAG_PROCESS | EVENT_TRACE_FLAG_IMAGE_LOAD | EVENT_TRACE_FLAG_NO_SYSCONFIG;
        settings->LoggerNameOffset = sizeof(EVENT_TRACE_PROPERTIES);
        memcpy(properties_.data() + settings->LoggerNameOffset, name_.c_str(), (name_.size() + 1) * sizeof(wchar_t));
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
    bool windowEventSeen(uintptr_t window, DWORD event) const {
        const auto resolution = correlateWindows(windows_, clockValid(), healthy());
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
        return std::any_of(windows_.begin(), windows_.end(), [&](const auto& fact) {
            const bool associated = std::any_of(consoles_.begin(), consoles_.end(), [&](const auto& event) {
                return event.pid == pid && event.window != 0 && event.window == fact.window;
            });
            const bool terminal = fact.kind == WindowKind::console || fact.kind == WindowKind::terminal || associated;
            return terminal && (fact.owner == pid || associated) && visibleIn(fact, 0, UINT64_MAX);
        });
    }
    std::vector<ProcessEvent> processes() {
        std::lock_guard<std::mutex> lock(mutex_);
        return processes_;
    }
    void assertHealthy() const { check(!lost_.load(), "observer lost data or could not complete capture"); }
    void bindRoot(DWORD pid, HANDLE process) { roots_[pid] = imagePath(process); }
    std::pair<size_t, size_t> entryCounts(const std::wstring& expected) {
        std::lock_guard<std::mutex> lock(mutex_);
        std::set<DWORD> roots, ended;
        for (const auto& event : processes_) {
            if (event.start && recap::samePath(executablePath(event.pid, event), expected)) roots.insert(event.pid);
            if (!event.start) ended.insert(event.pid);
        }
        size_t complete = 0;
        for (const auto pid : roots) if (ended.count(pid)) ++complete;
        return { roots.size(), complete };
    }
    std::vector<DWORD> registeredRoots(const std::wstring& expected, size_t count, DWORD exitCode) {
        check(stopped_, "registered roots require completed capture");
        assertHealthy();
        std::vector<DWORD> roots;
        const auto events = processes();
        for (const auto& event : events) {
            if (!event.start || !recap::samePath(executablePath(event.pid, event), expected)) continue;
            roots.push_back(event.pid);
            roots_[event.pid] = expected;
            check(std::any_of(events.begin(), events.end(), [&](const auto& end) {
                return !end.start && end.pid == event.pid && end.exitKnown && end.exitCode == exitCode;
            }), "registered GUI exit was not confirmed");
        }
        check(roots.size() == count, "registered GUI activation count differed");
        return roots;
    }
    std::wstring executablePath(DWORD pid, const ProcessEvent& event) {
        std::wstring path = event.image;
        if (images_.count(pid)) path = images_.at(pid);
        if (roots_.count(pid)) return roots_.at(pid);
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
    void reportAttribution(std::ostream& report, const std::vector<WindowResolution>& resolution,
                           const std::vector<size_t>& offenders, const std::set<DWORD>& owned) {
        std::set<size_t> emitted;
        const auto emit = [&](size_t index, const char* category) {
            if (index >= windows_.size() || !emitted.insert(index).second) return;
            const auto& raw = windows_[index];
            const auto& row = resolution[index];
            report << "DIAG attribution category=" << category << " row=" << index << " reason=" << row.reason
                   << " event=" << raw.event << " object=" << raw.object << " child=" << raw.child
                   << " hwnd=" << raw.window << " callback_thread=" << raw.callbackThread
                   << " source_thread=" << raw.sourceThread
                   << " source_owner=" << raw.sourceOwner << " source_error=" << raw.sourceError
                   << " raw_owner=" << raw.owner << " raw_thread=" << raw.thread
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

    void assertNoVisibleTerminals(const std::vector<DWORD>& roots, bool installed,
                                 const std::vector<WindowFact>& controls, std::ostream& report) {
        check(stopped_ && windowObservation_, "visible-terminal verdict requires completed window observation");
        const auto resolution = correlateWindows(windows_, clockValid(), healthy());
        if (!healthy() || !clockValid() || controls.size() != 2) {
            std::vector<size_t> rows;
            for (size_t index = 0; index < windows_.size(); ++index) rows.push_back(index);
            reportAttribution(report, resolution, rows, {});
            throw std::runtime_error("passive observation calibration clocks or capture were incomplete");
        }
        const auto events = processes();
        std::map<DWORD, ProcessEvent> starts;
        std::set<DWORD> ends, owned(roots.begin(), roots.end());
        for (const auto& event : events) {
            if (event.start) {
                check(!starts.count(event.pid), "PID reuse made trace identity ambiguous");
                starts.emplace(event.pid, event);
            } else ends.insert(event.pid);
        }
        for (size_t turn = 0; turn <= starts.size(); ++turn) {
            const auto before = owned.size();
            for (const auto& [pid, event] : starts) if (owned.count(event.parent)) owned.insert(pid);
            if (owned.size() == before) break;
        }
        bool coordinator = false, verifier = false, server = false, browser = false;
        wchar_t system[32768]{};
        check(GetSystemDirectoryW(system, static_cast<UINT>(std::size(system))) != 0, "system image root unavailable");
        std::set<std::wstring> packageRuntimes;
        for (const auto pid : roots) {
            check(roots_.count(pid) != 0, "registered GUI path was not bound");
            const auto& image = roots_.at(pid);
            packageRuntimes.insert(image.substr(0, image.find_last_of(L'\\')) + L"\\runtime\\node.exe");
        }
        for (const auto pid : roots) check(starts.count(pid) != 0, "native entry lifecycle was not captured");
        for (const auto pid : owned) {
            const auto found = starts.find(pid);
            if (found == starts.end()) continue;
            const auto& event = found->second;
            const auto path = executablePath(pid, event);
            if (event.command.find(L"Launcher.mjs") != std::wstring::npos) {
                coordinator = true;
                check(std::any_of(packageRuntimes.begin(), packageRuntimes.end(),
                    [&](const auto& expected) { return recap::samePath(path, expected); }),
                    "coordinator image binding was incomplete");
                check(event.command.find(L"--gui-startup-v1") != std::wstring::npos, "coordinator arguments differed");
                check(ends.count(pid) != 0, "coordinator exit lifecycle was not captured");
            }
            if (event.command.find(L"server.mjs") != std::wstring::npos) {
                server = true;
                check(std::any_of(packageRuntimes.begin(), packageRuntimes.end(),
                    [&](const auto& expected) { return recap::samePath(path, expected); }),
                    "server image binding was incomplete");
            }
            const auto name = path.substr(path.find_last_of(L"\\/") + 1);
            if (recap::samePath(name, L"powershell.exe")) {
                verifier = true;
                check(recap::samePath(path, std::wstring(system) + L"\\WindowsPowerShell\\v1.0\\powershell.exe"),
                      "verifier image binding was incomplete");
                check(ends.count(pid) != 0, "verifier lifecycle was incomplete");
            }
            if (recap::samePath(name, L"cmd.exe")) {
                browser = true;
                check(recap::samePath(path, std::wstring(system) + L"\\cmd.exe"), "browser helper image binding was incomplete");
                check(event.command.find(L"http://127.0.0.1:8787/") != std::wstring::npos, "browser helper origin differed");
                check(ends.count(pid) != 0, "browser-command lifecycle was incomplete");
            }
        }
        check(coordinator, "coordinator startup role was not captured");
        if (installed) check(verifier && server && browser, "installed startup role coverage was incomplete");
        std::set<uintptr_t> associated;
        for (const auto& event : consoles_)
            if (owned.count(event.pid) && event.window) associated.insert(event.window);
        std::set<size_t> calibrationLifetimes;
        for (const auto& known : controls) {
            std::set<size_t> candidates;
            std::vector<size_t> context;
            for (size_t index = 0; index < windows_.size(); ++index) {
                if (windows_[index].window != known.window) continue;
                context.push_back(index);
                const auto& row = resolution[index];
                if (row.identityKnown && !row.conflict && row.created && row.destroyed &&
                    row.owner == known.owner && row.thread == known.thread && row.kind == known.kind &&
                    row.beginTick <= known.received.tick && known.received.tick <= row.endTick)
                    candidates.insert(row.lifetime);
            }
            if (candidates.size() != 1) {
                reportAttribution(report, resolution, context, owned);
                throw std::runtime_error("calibration window lifetime made passive observation inconclusive");
            }
            calibrationLifetimes.insert(*candidates.begin());
        }
        std::set<DWORD> observers{ GetCurrentProcessId() };
        const auto observerImage = recap::modulePath();
        for (const auto& [pid, event] : starts) {
            if (event.parent == GetCurrentProcessId() &&
                event.command.find(L"--mode visual-worker") != std::wstring::npos &&
                recap::samePath(executablePath(pid, event), observerImage) && ends.count(pid)) observers.insert(pid);
        }
        std::vector<size_t> inconclusive, visible;
        for (size_t index = 0; index < windows_.size(); ++index) {
            const auto& fact = windows_[index];
            const auto& identity = resolution[index];
            const bool control = identity.identityKnown && !identity.conflict &&
                calibrationLifetimes.count(identity.lifetime);
            if (control) continue;
            const bool observerOnly = identity.identityKnown && !identity.conflict && identity.kind == WindowKind::other &&
                observers.count(identity.owner) && !associated.count(fact.window);
            if (observerOnly) continue;
            const bool terminal = identity.kind == WindowKind::console || identity.kind == WindowKind::terminal ||
                associated.count(fact.window);
            if (!identity.identityKnown || identity.conflict || identity.visibilityMissing ||
                (terminal && fact.event == EVENT_OBJECT_CREATE && !fact.metadataKnown)) {
                inconclusive.push_back(index);
                continue;
            }
            auto measured = fact;
            measured.owner = identity.owner;
            measured.thread = identity.thread;
            measured.kind = identity.kind;
            measured.identityKnown = identity.identityKnown;
            measured.metadataKnown = identity.identityKnown && fact.geometryKnown && fact.hierarchyKnown;
            if (!terminal || !visibleIn(measured, 0, UINT64_MAX)) continue;
            if (!owned.count(identity.owner) && !associated.count(fact.window)) inconclusive.push_back(index);
            else visible.push_back(index);
        }
        if (!inconclusive.empty()) {
            reportAttribution(report, resolution, inconclusive, owned);
            throw std::runtime_error("unmapped window lifecycle made passive observation inconclusive");
        }
        if (!visible.empty()) {
            reportAttribution(report, resolution, visible, owned);
            throw std::runtime_error("product process created a visible terminal");
        }
        size_t derived = 0;
        for (const auto& row : resolution) if (row.derived) ++derived;
        report << "DIAG attribution-complete raw_rows=" << windows_.size() << " derived_identities=" << derived
               << " visible_terminals=0 unknown=0 clocks=1 capture_healthy=1\n";
        report.flush();
    }
};
} // namespace proof
