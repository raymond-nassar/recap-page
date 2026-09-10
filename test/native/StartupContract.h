#pragma once

#include <windows.h>
#include <wincrypt.h>
#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <ostream>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace startup {
enum class State { satisfied, violated, unknown };
struct Premise {
    State state = State::satisfied;
    const char* reason = "none";
    void add(State next, const char* code) {
        if (state == State::violated || next == State::satisfied) return;
        if (next == State::violated || state == State::satisfied) { state = next; reason = code; }
    }
};
inline const char* stateName(State value) {
    return value == State::satisfied ? "satisfied" : value == State::violated ? "violated" : "unknown";
}
inline void require(bool value, const char* code) { if (!value) throw std::runtime_error(code); }
inline bool samePath(const std::wstring& a, const std::wstring& b) {
    return a.size() <= 32768 && b.size() <= 32768 &&
        CompareStringOrdinal(a.data(), static_cast<int>(a.size()), b.data(), static_cast<int>(b.size()), TRUE) == CSTR_EQUAL;
}
inline bool hex(const std::string& text, size_t count) {
    return text.size() == count && text.find_first_not_of("0123456789abcdef") == std::string::npos;
}
inline const char* architecture() {
#if defined(_M_ARM64)
    return "arm64";
#else
    return "x64";
#endif
}
struct Binding {
    std::string context, capture, commit, tree, architecture, proof, receipt, inputs;
    static Binding read(const std::wstring& path) {
        std::ifstream input(path, std::ios::binary);
        require(static_cast<bool>(input), "startup-context-unavailable");
        input.seekg(0, std::ios::end);
        const auto size = input.tellg();
        require(size > 0 && size <= 16384, "startup-context-size");
        input.seekg(0);
        std::array<std::string, 9> fields;
        for (auto& field : fields) {
            require(static_cast<bool>(std::getline(input, field)), "startup-context-incomplete");
            require(field.find_first_of("\r\t ") == std::string::npos, "startup-context-invalid");
        }
        require(input.peek() == std::char_traits<char>::eof(), "startup-context-extra");
        Binding result{ fields[1], fields[2], fields[3], fields[4], fields[5], fields[6], fields[7], fields[8] };
        require(fields[0] == "RCPAPP2" && hex(result.capture, 32) && hex(result.commit, 40) && hex(result.tree, 40) &&
                hex(result.proof, 64) && hex(result.receipt, 64) && hex(result.inputs, 64) &&
                result.architecture == startup::architecture(), "startup-context-binding");
        return result;
    }
    void print(std::ostream& out) const {
        out << " captureId=" << capture << " commit=" << commit << " tree=" << tree
            << " architecture=" << architecture << " proofInputDigest=" << proof
            << " creationReceiptDigest=" << receipt;
    }
};
struct RegistrySample {
    LONG open = ERROR_SUCCESS, query = ERROR_SUCCESS, close = ERROR_SUCCESS;
    DWORD type = 0, bytes = 0;
    bool empty = false;
    std::array<BYTE, 8192> data{};
    bool qualified() const {
        if (close != ERROR_SUCCESS) return false;
        if (open == ERROR_FILE_NOT_FOUND || (open == ERROR_SUCCESS && query == ERROR_FILE_NOT_FOUND)) return true;
        return open == ERROR_SUCCESS && query == ERROR_SUCCESS &&
            (type == REG_SZ || type == REG_EXPAND_SZ) && empty;
    }
    bool operator==(const RegistrySample& other) const {
        return open == other.open && query == other.query && close == other.close && type == other.type &&
            bytes == other.bytes && empty == other.empty && data == other.data;
    }
};
inline RegistrySample registrySample(HKEY hive) {
    RegistrySample result;
    HKEY key = nullptr;
    result.open = RegOpenKeyExW(hive, L"Software\\Microsoft\\Command Processor", 0,
                               KEY_QUERY_VALUE | KEY_WOW64_64KEY, &key);
    if (result.open != ERROR_SUCCESS) return result;
    result.bytes = static_cast<DWORD>(result.data.size());
    result.query = RegQueryValueExW(key, L"AutoRun", nullptr, &result.type, result.data.data(), &result.bytes);
    result.close = RegCloseKey(key);
    if (result.query == ERROR_FILE_NOT_FOUND) { result.bytes = result.type = 0; result.data.fill(0); }
    if (result.query == ERROR_SUCCESS) {
        result.empty = result.bytes == 0 || (result.bytes == sizeof(wchar_t) &&
            result.data[0] == 0 && result.data[1] == 0);
    }
    return result;
}
struct FileSample {
    bool known = false;
    DWORD error = 0, volume = 0, high = 0, low = 0;
    uint64_t bytes = 0, modified = 0;
    WORD machine = 0;
    std::array<BYTE, 32> hash{};
    bool operator==(const FileSample& other) const {
        return known && other.known && error == other.error && volume == other.volume &&
            high == other.high && low == other.low && bytes == other.bytes && modified == other.modified &&
            machine == other.machine && hash == other.hash;
    }
};
inline FileSample fileSample(const std::wstring& path) {
    FileSample result;
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) { result.error = GetLastError(); return result; }
    HCRYPTPROV provider = 0;
    HCRYPTHASH hash = 0;
    BY_HANDLE_FILE_INFORMATION before{}, after{};
    std::array<wchar_t, 32768> finalPath{};
    const DWORD length = GetFinalPathNameByHandleW(file, finalPath.data(), static_cast<DWORD>(finalPath.size()), FILE_NAME_NORMALIZED);
    std::wstring resolved;
    if (length && length < finalPath.size()) resolved.assign(finalPath.data(), length);
    if (resolved.compare(0, 4, L"\\\\?\\") == 0) resolved.erase(0, 4);
    bool ok = !resolved.empty() && samePath(resolved, path) && GetFileType(file) == FILE_TYPE_DISK &&
        GetFileInformationByHandle(file, &before) != FALSE && !(before.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY);
    result.bytes = (static_cast<uint64_t>(before.nFileSizeHigh) << 32) | before.nFileSizeLow;
    ok = ok && result.bytes >= 256 && result.bytes <= 160ULL * 1024 * 1024;
    if (ok) ok = CryptAcquireContextW(&provider, nullptr, MS_ENH_RSA_AES_PROV_W, PROV_RSA_AES, CRYPT_VERIFYCONTEXT) &&
        CryptCreateHash(provider, CALG_SHA_256, 0, 0, &hash);
    std::array<BYTE, 65536> buffer{};
    std::array<BYTE, 4096> header{};
    size_t headerSize = 0;
    uint64_t remaining = result.bytes;
    while (ok && remaining) {
        DWORD count = 0;
        ok = ReadFile(file, buffer.data(), static_cast<DWORD>(std::min<uint64_t>(buffer.size(), remaining)), &count, nullptr) && count;
        if (!ok) break;
        const auto copy = std::min<size_t>(header.size() - headerSize, count);
        if (copy) { memcpy(header.data() + headerSize, buffer.data(), copy); headerSize += copy; }
        ok = CryptHashData(hash, buffer.data(), count, 0) != FALSE;
        remaining -= count;
    }
    DWORD extra = 0, digestSize = static_cast<DWORD>(result.hash.size());
    if (ok) ok = ReadFile(file, buffer.data(), 1, &extra, nullptr) && !extra &&
        GetFileInformationByHandle(file, &after) && CryptGetHashParam(hash, HP_HASHVAL, result.hash.data(), &digestSize, 0) &&
        digestSize == result.hash.size() && before.dwVolumeSerialNumber == after.dwVolumeSerialNumber &&
        before.nFileIndexHigh == after.nFileIndexHigh && before.nFileIndexLow == after.nFileIndexLow &&
        before.nFileSizeHigh == after.nFileSizeHigh && before.nFileSizeLow == after.nFileSizeLow &&
        CompareFileTime(&before.ftLastWriteTime, &after.ftLastWriteTime) == 0;
    DWORD pe = 0;
    if (headerSize >= 64) memcpy(&pe, header.data() + 60, sizeof(pe));
    WORD magic = 0;
    ok = ok && headerSize >= 64 && header[0] == 'M' && header[1] == 'Z' &&
        pe <= headerSize && headerSize - pe >= 26 && memcmp(header.data() + pe, "PE\0\0", 4) == 0;
    if (ok) {
        memcpy(&result.machine, header.data() + pe + 4, sizeof(result.machine));
        memcpy(&magic, header.data() + pe + 24, sizeof(magic));
        ok = magic == 0x20b && (result.machine == IMAGE_FILE_MACHINE_AMD64 ||
            result.machine == IMAGE_FILE_MACHINE_ARM64 || result.machine == 0xa641);
    }
    if (!ok) { result.error = GetLastError(); if (!result.error) result.error = ERROR_INVALID_DATA; }
    if (hash && !CryptDestroyHash(hash)) { ok = false; result.error = GetLastError(); }
    if (provider && !CryptReleaseContext(provider, 0)) { ok = false; result.error = GetLastError(); }
    if (!CloseHandle(file)) { ok = false; result.error = GetLastError(); }
    result.known = ok;
    result.volume = before.dwVolumeSerialNumber; result.high = before.nFileIndexHigh; result.low = before.nFileIndexLow;
    result.modified = (static_cast<uint64_t>(before.ftLastWriteTime.dwHighDateTime) << 32) | before.ftLastWriteTime.dwLowDateTime;
    return result;
}
struct HostSample {
    bool evaluated = false;
    std::array<RegistrySample, 2> hives;
    std::array<FileSample, 2> helpers;
    bool qualified() const {
        return evaluated && hives[0].qualified() && hives[1].qualified() && helpers[0].known && helpers[1].known;
    }
};
inline Premise hostPremise(const HostSample& begin, const HostSample& end) {
    Premise result;
    if (!begin.qualified() || !end.qualified()) result.add(State::unknown, "host-unqualified");
    if (begin.evaluated && end.evaluated &&
        (!(begin.hives[0] == end.hives[0]) || !(begin.hives[1] == end.hives[1]) ||
         (begin.helpers[0].known && end.helpers[0].known && !(begin.helpers[0] == end.helpers[0])) ||
         (begin.helpers[1].known && end.helpers[1].known && !(begin.helpers[1] == end.helpers[1]))))
        result.add(State::violated, "host-changed");
    return result;
}
class HostCapture {
    Binding binding_;
    HostSample begin_, end_;
    bool finished_ = false, published_ = false;
    HostSample sample(std::ostream& out, const char* phase) const {
        HostSample result;
        result.evaluated = true;
        result.hives[0] = registrySample(HKEY_CURRENT_USER);
        result.hives[1] = registrySample(HKEY_LOCAL_MACHINE);
        result.helpers[0] = fileSample(command);
        result.helpers[1] = fileSample(verifier);
        for (size_t index = 0; index < 2; ++index) {
            const auto& hive = result.hives[index];
            const auto& helper = result.helpers[index];
            out << "DIAG host-sample phase=" << phase << " slot=" << index << " registryView=native64"
                << " open=" << hive.open << " query=" << hive.query << " type=" << hive.type << " bytes=" << hive.bytes
                << " literalEmpty=" << hive.empty << " registryClosed=" << (hive.close == ERROR_SUCCESS)
                << " helperKnown=" << helper.known << " helperMachine=" << helper.machine << " helperError=" << helper.error << "\n";
        }
        out.flush();
        return result;
    }
public:
    std::wstring command, verifier;
    HostCapture(Binding binding, std::ostream& out) : binding_(std::move(binding)) {
        std::array<wchar_t, 32768> system{};
        const auto length = GetSystemDirectoryW(system.data(), static_cast<UINT>(system.size()));
        require(length && length < system.size(), "host-system-directory-unavailable");
        command = std::wstring(system.data(), length) + L"\\cmd.exe";
        verifier = std::wstring(system.data(), length) + L"\\WindowsPowerShell\\v1.0\\powershell.exe";
        begin_ = sample(out, "begin");
    }
    bool beginningQualified() const { return begin_.qualified(); }
    bool completionPublished() const { return published_; }
    const Binding& binding() const { return binding_; }
    Premise finish(std::ostream& out) {
        if (!finished_) { end_ = sample(out, "end"); finished_ = true; }
        return hostPremise(begin_, end_);
    }
    void completion(std::ostream& out) {
        require(!published_, "host-completion-duplicate");
        const auto host = finish(out);
        published_ = true;
        out << "DIAG host-completion-v2 context=" << binding_.context;
        binding_.print(out);
        out << " beginEvaluated=" << begin_.evaluated << " endEvaluated=" << end_.evaluated
            << " beginState=" << (begin_.qualified() ? "satisfied" : "unknown")
            << " endState=" << (end_.qualified() ? "satisfied" : "unknown")
            << " registryView=native64 hiveSamplesBefore=2 hiveSamplesAfter=2 helperSnapshotPairs=2"
            << " helpersUnchanged=" << (begin_.helpers[0] == end_.helpers[0] && begin_.helpers[1] == end_.helpers[1])
            << " hostState=" << stateName(host.state) << " primaryReason=" << host.reason << "\n";
        out.flush();
    }
};

enum class Role { gui, coordinator, verifier, server, command, sentinel, unexpected };
enum class Profile { inert, functionality, busy };
struct FixtureIdentity {
    unsigned int fixture = 0;
    DWORD pid = 0, parent = 0, root = 0;
    uint64_t creation = 0, parentCreation = 0, rootCreation = 0;
    bool bound = false;
};
struct FixtureCleanupWitness {
    FixtureIdentity actor;
    uint64_t retainedQpc = 0, survivalQpc = 0, stopBeginQpc = 0, stopEndQpc = 0;
    unsigned int stopCalls = 0;
    bool survivalObserved = false, stopObserved = false, complete = false;
    bool terminationAttempted = false, terminationSucceeded = false, exitKnown = false;
    DWORD survivalWait = WAIT_FAILED, survivalError = 0, initialWait = WAIT_FAILED, finalWait = WAIT_FAILED;
    DWORD waitError = 0, terminationError = 0, requestedExit = 0, exitCode = 0, exitError = 0, clockError = 0;
};
inline Premise fixtureExit(const FixtureIdentity& actor, const FixtureCleanupWitness* witness,
                          bool exitKnown, DWORD exitCode) {
    Premise result;
    if (actor.fixture != 9 && actor.fixture != 10) {
        result.add(State::violated, "actor-wrong-input"); return result;
    }
    if (!witness) { result.add(State::unknown, "actor-missing"); return result; }
    const auto& bound = witness->actor;
    if (!actor.bound || !bound.bound || !actor.creation || !actor.parentCreation || !actor.rootCreation ||
        actor.fixture != bound.fixture || actor.pid != bound.pid || actor.parent != bound.parent ||
        actor.root != bound.root || actor.creation != bound.creation ||
        actor.parentCreation != bound.parentCreation || actor.rootCreation != bound.rootCreation) {
        result.add(State::unknown, "actor-ambiguous"); return result;
    }
    if (!witness->survivalObserved) result.add(State::unknown, "actor-missing");
    else if (witness->survivalWait == WAIT_OBJECT_0) result.add(State::violated, "behavior-mismatch");
    else if (witness->survivalWait != WAIT_TIMEOUT || witness->survivalError)
        result.add(State::unknown, "actor-missing");
    if (!witness->stopObserved) result.add(State::unknown, "actor-missing");
    else {
        if (witness->initialWait == WAIT_OBJECT_0) result.add(State::violated, "behavior-mismatch");
        if (witness->stopCalls != 1 || !witness->terminationAttempted || !witness->terminationSucceeded || !witness->complete ||
            witness->initialWait != WAIT_TIMEOUT || witness->finalWait != WAIT_OBJECT_0 ||
            witness->waitError || witness->terminationError)
            result.add(State::violated, "resource-cleanup-failed");
        if (witness->requestedExit != 2) result.add(State::violated, "behavior-mismatch");
    }
    if (!witness->retainedQpc || !witness->survivalQpc || !witness->stopBeginQpc || !witness->stopEndQpc ||
        witness->clockError || witness->retainedQpc > witness->survivalQpc ||
        witness->survivalQpc > witness->stopBeginQpc || witness->stopBeginQpc > witness->stopEndQpc)
        result.add(State::unknown, "actor-ambiguous");
    if (!witness->exitKnown || !exitKnown) result.add(State::unknown, "actor-missing");
    else if (witness->exitCode != witness->requestedExit || exitCode != witness->exitCode)
        result.add(State::violated, "behavior-mismatch");
    return result;
}
inline void printFixtureCleanup(std::ostream& out, const FixtureCleanupWitness& value) {
    out << " fixture=" << value.actor.fixture << " cleanup_pid=" << value.actor.pid
        << " cleanup_creation=" << value.actor.creation << " cleanup_parent=" << value.actor.parent
        << " cleanup_parent_creation=" << value.actor.parentCreation << " cleanup_root=" << value.actor.root
        << " cleanup_root_creation=" << value.actor.rootCreation << " retained_qpc=" << value.retainedQpc
        << " survival_observed=" << value.survivalObserved << " survival_wait=" << value.survivalWait
        << " survival_error=" << value.survivalError << " survival_qpc=" << value.survivalQpc
        << " stop_observed=" << value.stopObserved << " stop_calls=" << value.stopCalls << " stop_begin_qpc=" << value.stopBeginQpc
        << " stop_end_qpc=" << value.stopEndQpc << " stop_clock_error=" << value.clockError
        << " stop_attempted=" << value.terminationAttempted << " stop_succeeded=" << value.terminationSucceeded
        << " stop_complete=" << value.complete << " stop_initial_wait=" << value.initialWait
        << " stop_final_wait=" << value.finalWait << " stop_wait_error=" << value.waitError
        << " stop_error=" << value.terminationError << " stop_requested_exit=" << value.requestedExit
        << " stop_exit_known=" << value.exitKnown << " stop_exit=" << value.exitCode << " stop_exit_error=" << value.exitError;
}
struct Actor {
    Role role = Role::unexpected;
    bool identity = true, image = true, arguments = true, parent = true;
    bool exitKnown = true, exitExpected = true, retainedLive = false;
    bool exitExpectationKnown = true, imageKnown = false, argumentsKnown = false;
    DWORD exitCode = 0;
    const char* exitReason = "behavior-mismatch";
};
inline void applyFixtureExit(Actor& actor, const FixtureIdentity& identity, const FixtureCleanupWitness* witness) {
    const auto result = fixtureExit(identity, witness, actor.exitKnown, actor.exitCode);
    actor.exitExpectationKnown = result.state != State::unknown;
    actor.exitExpected = result.state == State::satisfied;
    actor.exitReason = result.reason;
}
inline Premise actorPremise(const Actor& actor) {
    Premise result;
    if (actor.role == Role::unexpected)
        result.add(actor.identity ? State::violated : State::unknown, actor.identity ? "actor-unexpected" : "actor-missing");
    if (!actor.identity || !actor.parent) result.add(State::unknown, "actor-ambiguous");
    if (!actor.image || !actor.arguments) result.add(State::violated, "actor-wrong-input");
    if (!actor.retainedLive && !actor.exitKnown) result.add(State::unknown, "actor-missing");
    if (!actor.exitExpectationKnown) result.add(State::unknown, actor.exitReason);
    else if (!actor.exitExpected) result.add(State::violated, actor.exitReason);
    return result;
}
struct ActorContext {
    size_t instance = SIZE_MAX, parent = SIZE_MAX;
    Actor fact;
};
inline std::vector<size_t> prioritizeActorContext(const std::vector<ActorContext>& actors,
                                                const std::vector<size_t>& linked,
                                                const std::vector<size_t>& remaining) {
    std::vector<size_t> result;
    std::set<size_t> present;
    const auto add = [&](size_t index) {
        if (index != SIZE_MAX && present.insert(index).second) result.push_back(index);
    };
    for (const auto& actor : actors) if (actorPremise(actor.fact).state != State::satisfied) add(actor.instance);
    for (const auto& actor : actors) if (actorPremise(actor.fact).state != State::satisfied) add(actor.parent);
    for (const auto index : linked) add(index);
    for (const auto index : remaining) add(index);
    return result;
}
struct Terminal {
    bool appLinked = false, visible = false, complete = true;
};
struct Evidence {
    Profile profile = Profile::inert;
    size_t expectedRoots = 11, expectedCoordinators = 9;
    bool healthy = true, clocks = true, stopped = true, calibrated = true, candidateAmbiguous = false;
    std::vector<Actor> actors;
    std::vector<Terminal> terminals;
};
struct ActorResult {
    Premise actors, capture;
    size_t roots = 0, coordinators = 0, verifiers = 0, servers = 0, commands = 0, liveServers = 0, visible = 0, unresolved = 0;
};
inline ActorResult reduceActors(const Evidence& evidence) {
    ActorResult result;
    for (const auto& actor : evidence.actors) {
        switch (actor.role) {
        case Role::gui: ++result.roots; break;
        case Role::coordinator: ++result.coordinators; break;
        case Role::verifier: ++result.verifiers; break;
        case Role::server: ++result.servers; if (actor.retainedLive) ++result.liveServers; break;
        case Role::command: ++result.commands; break;
        default: break;
        }
        const auto premise = actorPremise(actor);
        result.actors.add(premise.state, premise.reason);
    }
    if (result.roots != evidence.expectedRoots || result.coordinators != evidence.expectedCoordinators)
        result.actors.add(State::unknown, "actor-missing");
    if (evidence.candidateAmbiguous) result.actors.add(State::unknown, "actor-ambiguous");
    if (evidence.profile == Profile::functionality &&
        (!result.verifiers || result.commands != evidence.expectedRoots || result.liveServers != 1))
        result.actors.add(State::unknown, "actor-missing");
    if (evidence.profile == Profile::busy && (result.verifiers || result.commands || result.servers))
        result.actors.add(State::violated, "actor-unexpected");
    if (!evidence.healthy || !evidence.clocks || !evidence.stopped || !evidence.calibrated)
        result.capture.add(State::unknown, "capture-incomplete");
    for (const auto& terminal : evidence.terminals) {
        if (!terminal.appLinked) continue;
        if (terminal.visible) { ++result.visible; result.capture.add(State::violated, "app-terminal-visible"); }
        else if (!terminal.complete) { ++result.unresolved; result.capture.add(State::unknown, "app-console-association-incomplete"); }
    }
    return result;
}
inline void printCapture(std::ostream& out, const Binding& binding, const Premise& host, const ActorResult& result,
                         size_t rawUnknown, size_t unassessed, size_t requests) {
    out << "DIAG app-capture-v2 profile=" << binding.context;
    binding.print(out);
    out << " startupInputsDigest=" << binding.inputs << " hostState=" << stateName(host.state) << " hostReason=" << host.reason
        << " actorState=" << stateName(result.actors.state) << " actorReason=" << result.actors.reason
        << " captureState=" << stateName(result.capture.state) << " captureReason=" << result.capture.reason
        << " roots=" << result.roots << " coordinators=" << result.coordinators << " verifiers=" << result.verifiers
        << " servers=" << result.servers << " commands=" << result.commands << " visible=" << result.visible
        << " unresolved=" << result.unresolved << " rawUnknown=" << rawUnknown << " unassessed=" << unassessed
        << " externalRequests=" << requests << "\n";
    out.flush();
}
} // namespace startup
