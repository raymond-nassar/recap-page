#include "ServerOwnership.h"

namespace {
bool writeResult(const recap::ownership::Result& result) {
    const auto bytes = recap::ownership::record(result);
    if (bytes.size() > recap::ownership::RecordLimit) return false;
    const HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
    if (!output || output == INVALID_HANDLE_VALUE) return false;
    size_t offset = 0;
    while (offset < bytes.size()) {
        DWORD written = 0;
        if (!WriteFile(output, bytes.data() + offset, static_cast<DWORD>(bytes.size() - offset), &written, nullptr) || !written)
            return false;
        offset += written;
    }
    return true;
}

recap::ownership::Result run() {
    using namespace recap::ownership;
    int count = 0;
    auto* args = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!args) return unknown(Stage::process, Reason::nativeReturn, GetLastError());
    std::unique_ptr<void, decltype(&LocalFree)> allocation(args, &LocalFree);
    DWORD pid = 0;
    if (count != 2 || !parsePid(args[1], pid))
        return unknown(Stage::process, Reason::invalidResponse, ERROR_INVALID_PARAMETER);
    const auto expected = packagedExpectations();
    WinApi api;
    return verify(pid, expected, api);
}
}

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);
    recap::ownership::Result result;
    try {
        result = run();
    } catch (const recap::ownership::Failure& error) {
        result = error.result;
    } catch (const std::bad_alloc&) {
        result = recap::ownership::unknown(recap::ownership::Stage::process, recap::ownership::Reason::exception, E_OUTOFMEMORY);
    } catch (...) {
        result = recap::ownership::unknown(recap::ownership::Stage::process, recap::ownership::Reason::exception, E_FAIL);
    }
    try { return writeResult(result) ? 0 : 1; }
    catch (...) { return 1; }
}
