#pragma once

#include "StartupProcess.h"
#include <objbase.h>
#include <evntrace.h>
#include <evntcons.h>
#include <tdh.h>
#include <atomic>
#include <array>
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
    bool consoleBound = false, completeControl = false;
    DWORD presenter = 0, presenterThread = 0, client = 0;
    const char* reason = "missing-identity";
};

struct WindowLifetime {
    std::vector<size_t> rows;
    bool created = false, closed = false, conflict = false;
};

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
    struct Actor {
        recap::Handle process, thread;
        DWORD pid = 0, tid = 0;
        uint64_t processCreation = 0, threadCreation = 0, capturedQpc = 0;
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
    std::vector<Actor> actors_;
    std::map<DWORD, Client> clients_;
    std::vector<ControlAssociation> controlAssociations_;
    std::wstring classicHostImage_;
    std::ostream* report_ = nullptr;
    bool identitiesClosed_ = false;

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
        for (size_t index = 0; index < actors_.size(); ++index) {
            auto& value = actors_[index];
            if (value.pid == pid && value.tid == tid && value.processCreation == processBorn &&
                value.threadCreation == threadBorn) {
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
        value.liveAtCapture = WaitForSingleObject(process, 0) == WAIT_TIMEOUT &&
            WaitForSingleObject(thread, 0) == WAIT_TIMEOUT;
        value.capturedQpc = moment().qpc;
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
    size_t observeSource(DWORD tid, WindowFact& raw, bool retain, bool recover) {
        if (!tid) return 0;
        ++identityCounts_.sourceThreadOpens;
        ObservedHandle thread(*this, OpenThread(THREAD_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, tid));
        if (thread) raw.sourceOwner = GetProcessIdOfThread(thread.get());
        if (!thread || !raw.sourceOwner) raw.sourceError = GetLastError();
        if (thread && raw.sourceOwner) {
            raw.sourceThreadKnown = creation(thread.get(), true, raw.sourceThreadCreation);
            if (!raw.sourceThreadKnown) raw.sourceError = GetLastError();
            if (!retain || !raw.sourceThreadKnown) return 0;
            ++identityCounts_.sourceProcessOpens;
            ObservedHandle process(*this, OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, raw.sourceOwner));
            if (!process) { raw.sourceError = GetLastError(); return 0; }
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
        const ProcessEvent* start = nullptr;
        for (const auto& event : events) {
            if (event.pid != value.pid) continue;
            if (event.start) {
                if (start) return false;
                start = &event;
            } else if (event.timestamp > 0 && static_cast<uint64_t>(event.timestamp) < value.capturedQpc) {
                return false;
            }
        }
        if (!start || start->timestamp <= 0 || static_cast<uint64_t>(start->timestamp) > value.capturedQpc) return false;
        if (!presenter) return true;
        const auto image = executablePath(value.pid, *start);
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
        if (report_) {
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
            check(current_->windows_.size() < 8192, "window observation bound exceeded");
            current_->windows_.push_back(fact);
        } catch (const std::exception&) { current_->lost_.store(true); }
    }
public:
    explicit Observer(bool observeWindows = false) : windowObservation_(observeWindows) {
        check(current_ == nullptr, "observer already active");
        wchar_t system[32768]{};
        const auto systemLength = GetSystemDirectoryW(system, static_cast<UINT>(std::size(system)));
        check(systemLength && systemLength < std::size(system), "trusted console host path unavailable");
        classicHostImage_ = recap::normalizedPath(std::wstring(system) + L"\\conhost.exe");
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
            const auto* client = actor(clientId);
            if (client && knownClient != clients_.end()) {
                binding.clientActor = clientId;
                binding.clientThread = client->tid;
                binding.clientKnown = !clientConflict && client->instanceKnown && client->liveAtCapture &&
                    client->pid == clientPid && client->processCreation == knownClient->second.creation;
                binding.clientThreadBound = client->instanceKnown;
                binding.clientEtw = etwInstance(*client, processes_, false);
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
    void bindRoot(DWORD pid, HANDLE process) {
        roots_[pid] = imagePath(process);
        bindClient(pid, process);
    }
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
    std::wstring executablePath(DWORD pid, const ProcessEvent& event) const {
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
                   << " source_actor=" << raw.sourceActor << " reported_actor=" << raw.reportedActor
                   << " source_thread_known=" << raw.sourceThreadKnown << " source_thread_creation=" << raw.sourceThreadCreation
                   << " source_retained=" << raw.sourceRetained
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
        assertHealthy();
        const auto resolution = resolvedWindows();
        requireCalibrationLifetimes(controls, report, resolution);
        reportBindings(report);
    }

    void assertNoVisibleTerminals(const std::vector<DWORD>& roots, bool installed,
                                 const std::vector<WindowFact>& controls, std::ostream& report) {
        check(stopped_ && windowObservation_, "visible-terminal verdict requires completed window observation");
        const auto resolution = resolvedWindows();
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
        const auto calibrationLifetimes = requireCalibrationLifetimes(controls, report, resolution);
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
            const bool possibleConsole = std::any_of(owned.begin(), owned.end(),
                [&](DWORD pid) { return potentialConsole(pid, fact, identity); });
            const bool observerOnly = identity.identityKnown && !identity.conflict && identity.kind == WindowKind::other &&
                observers.count(identity.owner) && !possibleConsole;
            if (observerOnly) continue;
            const bool terminal = identity.kind == WindowKind::console || identity.kind == WindowKind::terminal || possibleConsole;
            if (!identity.identityKnown || identity.conflict || identity.visibilityMissing ||
                (possibleConsole && !identity.consoleBound) ||
                (terminal && !identity.consoleBound && fact.event == EVENT_OBJECT_CREATE && !fact.metadataKnown)) {
                inconclusive.push_back(index);
                continue;
            }
            const auto measured = effectiveWindow(fact, identity);
            if (!terminal || !visibleIn(measured, 0, UINT64_MAX)) continue;
            if (!owned.count(identity.owner)) inconclusive.push_back(index);
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
