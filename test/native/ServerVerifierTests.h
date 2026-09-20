#pragma once

#include "../../packaging/windows/native/ServerOwnership.h"
#include <filesystem>
#include <fstream>
#include <thread>

namespace recap::ownership::tests {
inline void check(bool value, const char* message) {
    if (!value) throw std::runtime_error(message);
}

class FakeApi final : public Api {
public:
    ULONGLONG clock = 0;
    int listeners = 0, rechecks = 0;
    bool wrongImage = false, wrongCommand = false, changedCreation = false, lostOwner = false;
    bool queryError = false, queryTimeout = false;
    Expectations expected{ L"C:\\fixture\\runtime\\node.exe", L"C:\\fixture\\server.mjs", 8787 };
    ULONGLONG now() const override { return clock; }
    Result listener(DWORD, USHORT) override {
        ++listeners;
        return lostOwner && listeners == 2 ? foreign(Stage::ipOwner, Reason::notOwned) : pass();
    }
    Result retain(DWORD pid, Target& target) override {
        target.pid = pid;
        target.creation = { 1, 2 };
        return pass();
    }
    Result image(const Target&, std::wstring& path) override {
        path = wrongImage ? L"C:\\foreign\\node.exe" : expected.node;
        return pass();
    }
    Result commandLine(const Target&, const Deadline&, std::wstring& command) override {
        if (queryError) return unknown(Stage::wmi, Reason::nativeReturn, E_ACCESSDENIED);
        if (queryTimeout) clock += DeadlineMs;
        command = recap::quoted(expected.node) + L" " +
            recap::quoted(wrongCommand ? L"C:\\foreign\\server.mjs" : expected.server);
        return pass();
    }
    Result recheck(const Target& target) override {
        ++rechecks;
        FILETIME current = target.creation;
        if (changedCreation) ++current.dwLowDateTime;
        return equalCreation(target.creation, current)
            ? pass() : unknown(Stage::identity, Reason::mismatch, ERROR_INVALID_DATA);
    }
};

inline void unitCases() {
    DWORD pid = 0;
    check(parsePid(L"1", pid) && pid == 1, "server-verifier/min-pid");
    check(parsePid(L"4294967295", pid) && pid == MAXDWORD, "server-verifier/max-pid");
    for (const auto* text : { L"", L"0", L"01", L"-1", L"+1", L"1 2", L"4294967296", L"1x" })
        check(!parsePid(text, pid), "server-verifier/invalid-pid");

    constexpr size_t offset = offsetof(MIB_TCPTABLE_OWNER_PID, table);
    check(offset == 4 && sizeof(MIB_TCPROW_OWNER_PID) == 24, "server-verifier/native-row-layout");
    std::array<DWORD, 7> row{ 1, 2, 0x0100007f, 0x5322, 0, 0, 41 };
    const auto decode = [&](const std::array<DWORD, 7>& value, size_t bytes = 7 * sizeof(DWORD)) {
        return decodeListener(reinterpret_cast<const unsigned char*>(value.data()), bytes, 41, 8787);
    };
    check(decode(row).owned == Owned::yes, "server-verifier/decoder-positive");
    for (const auto& mutation : std::array<std::pair<size_t, DWORD>, 6>{
        std::pair<size_t, DWORD>{ 1, 5 }, { 2, 0 }, { 2, 0x7f000001 }, { 3, 8787 }, { 3, 0x5422 }, { 6, 42 }
    }) {
        auto changed = row;
        changed[mutation.first] = mutation.second;
        check(decode(changed).owned == Owned::no, "server-verifier/decoder-negative");
    }
    check(decode(row, sizeof(row) - 1).owned == Owned::unknown, "server-verifier/truncated-row");
    auto badCount = row;
    badCount[0] = MAXDWORD;
    check(decode(badCount).owned == Owned::unknown, "server-verifier/row-count-bound");
    check(decodeListener(nullptr, 28, 41, 8787).owned == Owned::unknown, "server-verifier/null-buffer");

    for (int mode = 0; mode <= 7; ++mode) {
        int calls = 0;
        const auto query = [&](PVOID table, PDWORD size, BOOL order, ULONG family, TCP_TABLE_CLASS tableClass, ULONG reserved) -> DWORD {
            ++calls;
            check(!order && family == AF_INET && tableClass == TCP_TABLE_OWNER_PID_LISTENER && !reserved,
                "server-verifier/tcp-query-contract");
            if (!table) {
                check(*size == 0, "server-verifier/initial-size");
                *size = mode == 2 ? 0 : mode == 3 ? TableLimit + 1 : static_cast<DWORD>(sizeof(row));
                return mode == 1 ? ERROR_ACCESS_DENIED : ERROR_INSUFFICIENT_BUFFER;
            }
            check(*size == sizeof(row), "server-verifier/allocation-size");
            if (mode == 4) { *size += 24; return ERROR_INSUFFICIENT_BUFFER; }
            if (mode == 5) return ERROR_ACCESS_DENIED;
            if (mode == 6) { ++*size; return NO_ERROR; }
            auto bytes = row;
            if (mode == 7) bytes[0] = 2;
            std::memcpy(table, bytes.data(), sizeof(bytes));
            return NO_ERROR;
        };
        const auto result = listenerWith(query, 41, 8787);
        check(result.owned == (mode == 0 ? Owned::yes : Owned::unknown), "server-verifier/tcp-error-closed");
        check(calls == (mode >= 1 && mode <= 3 ? 1 : 2), "server-verifier/tcp-call-bound");
    }

    FakeApi good;
    check(verify(41, good.expected, good).owned == Owned::yes, "server-verifier/core-positive");
    check(good.listeners == 2 && good.rechecks == 2, "server-verifier/recheck-count");
    for (int mode = 0; mode < 6; ++mode) {
        FakeApi api;
        api.wrongImage = mode == 0;
        api.wrongCommand = mode == 1;
        api.changedCreation = mode == 2;
        api.lostOwner = mode == 3;
        api.queryError = mode == 4;
        api.queryTimeout = mode == 5;
        const auto result = verify(41, api.expected, api);
        const auto expected = mode == 0 || mode == 1 || mode == 3 ? Owned::no : Owned::unknown;
        check(result.owned == expected, "server-verifier/core-negative");
        if (mode == 5) check(result.reason == Reason::timeout && result.stage == Stage::wmi, "server-verifier/budget");
    }
    for (const auto& command : {
        recap::quoted(good.expected.node),
        recap::quoted(good.expected.node) + L" " + recap::quoted(good.expected.server) + L" extra",
        recap::quoted(good.expected.node) + L" " + recap::quoted(good.expected.server + L".foreign"),
        recap::quoted(L"C:\\foreign\\node.exe") + L" " + recap::quoted(good.expected.server)
    }) check(validateCommand(command, good.expected).owned == Owned::no, "server-verifier/exact-argv");
    check(validateCommand(std::wstring(L"x\0y", 3), good.expected).owned == Owned::unknown, "server-verifier/embedded-null");
    check(record(pass()) == std::string("{\"schema\":\"RCPN1\",\"owned\":true,\"stage\":\"complete\",\"reason\":\"ok\",\"code\":0,\"helperBits\":")
        + std::to_string(sizeof(void*) * 8) + "}\n", "server-verifier/wire-golden");
}

class CallDeadline {
    recap::Handle done_;
    std::thread watcher_;
public:
    CallDeadline() : done_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {
        check(static_cast<bool>(done_), "server-verifier/deadline-event");
        watcher_ = std::thread([event = done_.get()] {
            if (WaitForSingleObject(event, DeadlineMs) != WAIT_OBJECT_0)
                TerminateProcess(GetCurrentProcess(), ERROR_TIMEOUT);
        });
    }
    CallDeadline(const CallDeadline&) = delete;
    CallDeadline& operator=(const CallDeadline&) = delete;
    ~CallDeadline() {
        SetEvent(done_.get());
        watcher_.join();
    }
};

class OwnedNode {
public:
    recap::Handle job, process, output;
    DWORD pid = 0;
    OwnedNode(const Expectations& expected) {
        job = recap::Handle(CreateJobObjectW(nullptr, nullptr));
        check(static_cast<bool>(job), "server-verifier/fixture-job");
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        check(SetInformationJobObject(job.get(), JobObjectExtendedLimitInformation, &limits, static_cast<DWORD>(sizeof(limits))) != FALSE,
            "server-verifier/fixture-job-limit");
        SECURITY_ATTRIBUTES security{ sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE };
        HANDLE read = nullptr, write = nullptr;
        check(CreatePipe(&read, &write, &security, 0) != FALSE, "server-verifier/fixture-pipe");
        output = recap::Handle(read);
        recap::Handle writer(write);
        check(SetHandleInformation(output.get(), HANDLE_FLAG_INHERIT, 0) != FALSE, "server-verifier/fixture-read-inheritance");
        recap::Handle null(CreateFileW(L"NUL", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
            &security, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
        check(static_cast<bool>(null), "server-verifier/fixture-null");
        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        startup.dwFlags = STARTF_USESTDHANDLES;
        startup.hStdInput = null.get();
        startup.hStdOutput = writer.get();
        startup.hStdError = null.get();
        PROCESS_INFORMATION created{};
        auto command = recap::quoted(expected.node) + L" " + recap::quoted(expected.server);
        auto environment = recap::childEnvironment();
        check(CreateProcessW(expected.node.c_str(), command.data(), nullptr, nullptr, TRUE,
            CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, environment.data(), nullptr, &startup, &created) != FALSE,
            "server-verifier/fixture-spawn");
        process = recap::Handle(created.hProcess);
        recap::Handle thread(created.hThread);
        pid = created.dwProcessId;
        if (!AssignProcessToJobObject(job.get(), process.get()) || ResumeThread(thread.get()) == static_cast<DWORD>(-1)) {
            TerminateProcess(process.get(), 1);
            WaitForSingleObject(process.get(), 2000);
            throw std::runtime_error("server-verifier/fixture-resume");
        }
    }
    OwnedNode(const OwnedNode&) = delete;
    OwnedNode& operator=(const OwnedNode&) = delete;
    ~OwnedNode() {
        if (process && WaitForSingleObject(process.get(), 0) == WAIT_TIMEOUT) {
            TerminateProcess(process.get(), 1);
            WaitForSingleObject(process.get(), 2000);
        }
    }
    USHORT port() {
        std::string text;
        const ULONGLONG start = GetTickCount64();
        while (GetTickCount64() - start < DeadlineMs && text.size() < 16) {
            DWORD available = 0;
            check(PeekNamedPipe(output.get(), nullptr, 0, nullptr, &available, nullptr) != FALSE, "server-verifier/fixture-ready-pipe");
            if (!available) { Sleep(10); continue; }
            char value = 0;
            DWORD count = 0;
            check(ReadFile(output.get(), &value, 1, &count, nullptr) && count == 1, "server-verifier/fixture-ready-read");
            if (value == '\n') {
                DWORD number = 0;
                check(parsePid(std::wstring(text.begin(), text.end()), number) && number <= 65535, "server-verifier/fixture-port");
                return static_cast<USHORT>(number);
            }
            check(value >= '0' && value <= '9', "server-verifier/fixture-ready-byte");
            text += value;
        }
        throw std::runtime_error("server-verifier/fixture-ready-timeout");
    }
    void stop() {
        if (WaitForSingleObject(process.get(), 0) == WAIT_TIMEOUT)
            check(TerminateProcess(process.get(), 0) != FALSE, "server-verifier/fixture-stop");
        check(WaitForSingleObject(process.get(), 2000) == WAIT_OBJECT_0, "server-verifier/fixture-stop-timeout");
    }
};

// Call in the proof worker before any WMI/UIAutomation activation initializes COM security.
inline void run(const std::wstring& nodeRuntime, const std::filesystem::path& scratchDirectory) {
    unitCases();
    const auto directory = scratchDirectory / (L"server-ownership-" + std::to_wstring(GetCurrentProcessId()));
    check(std::filesystem::create_directory(directory), "server-verifier/fixture-directory");
    struct Cleanup {
        std::filesystem::path directory;
        ~Cleanup() {
            std::error_code error;
            std::filesystem::remove(directory / L"server.mjs", error);
            error.clear();
            std::filesystem::remove(directory, error);
        }
    } cleanup{ directory };
    const auto script = directory / L"server.mjs";
    {
        std::ofstream file(script, std::ios::binary);
        file << "import net from 'node:net'; const server=net.createServer(socket=>socket.destroy());"
                "server.listen(0,'127.0.0.1',()=>process.stdout.write(String(server.address().port)+'\\n'));\n";
        file.close();
        check(static_cast<bool>(file), "server-verifier/fixture-script");
    }
    Expectations expected{ canonicalFile(nodeRuntime), canonicalFile(script.wstring()), 0 };
    OwnedNode child(expected);
    expected.port = child.port();
    WinApi api;
    const auto invoke = [&](DWORD pid, const Expectations& value) {
        CallDeadline deadline;
        return verify(pid, value, api);
    };
    auto result = invoke(child.pid, expected);
    if (result.owned != Owned::yes) throw std::runtime_error("server-verifier/owned-fixture " + record(result));
    check(invoke(child.pid == MAXDWORD ? child.pid - 1 : child.pid + 1, expected).owned == Owned::no,
        "server-verifier/wrong-pid");
    auto wrong = expected;
    wrong.node += L".foreign";
    check(invoke(child.pid, wrong).owned == Owned::no, "server-verifier/wrong-image");
    wrong = expected;
    wrong.server += L".foreign";
    check(invoke(child.pid, wrong).owned == Owned::no, "server-verifier/wrong-command");
    child.stop();
    check(invoke(child.pid, expected).owned == Owned::no, "server-verifier/closed-listener");
    check(std::filesystem::remove(script) && std::filesystem::remove(directory), "server-verifier/fixture-cleanup");
}
}
