#include "StartupProtocol.h"
#include "StartupProcess.h"
#include "StartupObserver.h"
#include <ole2.h>
#include <UIAutomation.h>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>

namespace fs = std::filesystem;
using proof::check;

namespace {
struct Child {
    recap::Handle process;
    DWORD pid = 0;
    ~Child() {
        if (process && WaitForSingleObject(process.get(), 0) == WAIT_TIMEOUT) {
            TerminateProcess(process.get(), 2);
            WaitForSingleObject(process.get(), 2000);
        }
    }
    DWORD exit() const {
        DWORD code = STILL_ACTIVE;
        check(GetExitCodeProcess(process.get(), &code) != FALSE, "owned exit query failed");
        return code;
    }
    void stop() {
        if (WaitForSingleObject(process.get(), 0) == WAIT_TIMEOUT) {
            check(TerminateProcess(process.get(), 2) != FALSE, "owned fixture process could not stop");
            check(WaitForSingleObject(process.get(), 2000) == WAIT_OBJECT_0, "owned fixture cleanup timed out");
        }
    }
};

void start(Child& child, const std::wstring& executable, const std::wstring& arguments = L"",
           DWORD flags = CREATE_NO_WINDOW, BOOL inherit = FALSE) {
    auto command = recap::quoted(executable) + (arguments.empty() ? L"" : L" " + arguments);
    STARTUPINFOW startup{ sizeof(STARTUPINFOW) };
    PROCESS_INFORMATION process{};
    check(CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, inherit, flags,
        nullptr, nullptr, &startup, &process) != FALSE, "fixture process creation failed");
    child.process = recap::Handle(process.hProcess);
    child.pid = process.dwProcessId;
    CloseHandle(process.hThread);
}

void retain(Child& child, DWORD pid, const std::wstring& expected) {
    recap::Handle candidate(OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION |
        PROCESS_TERMINATE | PROCESS_DUP_HANDLE, FALSE, pid));
    check(static_cast<bool>(candidate), "fixture child ownership could not be retained");
    check(recap::samePath(proof::imagePath(candidate.get()), expected), "fixture child image differs");
    child.process = std::move(candidate);
    child.pid = pid;
}

std::string read(const fs::path& path) {
    std::ifstream input(path, std::ios::binary);
    check(static_cast<bool>(input), "fixture input is missing");
    return { std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>() };
}

void write(const fs::path& path, const std::string& text) {
    std::ofstream output(path, std::ios::binary);
    output << text;
    check(static_cast<bool>(output), "fixture output could not be written");
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
    const auto length = static_cast<size_t>(SendMessageW(control, WM_GETTEXTLENGTH, 0, 0));
    check(length < 256 * 1024, "native text exceeded its display bound");
    std::vector<wchar_t> buffer(length + 1);
    SendMessageW(control, WM_GETTEXT, buffer.size(), reinterpret_cast<LPARAM>(buffer.data()));
    return { buffer.data() };
}

void responsive(HWND window) {
    DWORD_PTR result = 0;
    check(SendMessageTimeoutW(window, WM_NULL, 0, 0, SMTO_ABORTIFHUNG, 2000, &result) != 0,
          "native message loop did not respond");
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

template<class T> struct Com {
    T* value = nullptr;
    Com() = default;
    Com(const Com&) = delete;
    Com& operator=(const Com&) = delete;
    ~Com() { if (value) value->Release(); }
    T** put() { return &value; }
    T* operator->() { return value; }
};

void accessible(HWND window, bool failed) {
    responsive(window);
    Com<IUIAutomation> automation;
    check(SUCCEEDED(CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(automation.put()))), "UI Automation could not start");
    for (const auto& item : std::vector<std::pair<int, std::wstring>>{
        {201, L"RECAP PAGE!"}, {203, failed ? L"Close" : L"Hide startup window"}
    }) {
        Com<IUIAutomationElement> element;
        check(SUCCEEDED(automation->ElementFromHandle(GetDlgItem(window, item.first), element.put())),
              "native accessible element missing");
        BSTR name = nullptr;
        check(SUCCEEDED(element->get_CurrentName(&name)), "native accessible name unavailable");
        const std::wstring actual(name ? name : L"");
        SysFreeString(name);
        check(actual == item.second, "native accessible name differed");
        CONTROLTYPEID type = 0;
        check(SUCCEEDED(element->get_CurrentControlType(&type)), "native accessible role unavailable");
        check(type == (item.first == 203 ? UIA_ButtonControlTypeId : UIA_TextControlTypeId),
              "native accessible role differed");
    }
    if (failed) {
        Com<IUIAutomationElement> element;
        check(SUCCEEDED(automation->ElementFromHandle(GetDlgItem(window, 204), element.put())),
              "error text is inaccessible");
        Com<IUIAutomationValuePattern> value;
        check(SUCCEEDED(element->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(value.put()))),
              "error text has no accessible value");
        BOOL readonly = FALSE;
        check(SUCCEEDED(value->get_CurrentIsReadOnly(&readonly)) && readonly, "error text is not read-only");
        Com<IUIAutomationTextPattern> text;
        check(SUCCEEDED(element->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(text.put()))),
              "error text cannot be selected");
        Com<IUIAutomationTextRange> range;
        check(SUCCEEDED(text->get_DocumentRange(range.put())) && SUCCEEDED(range->Select()),
              "error text selection failed");
    }
}

void bounds(HWND window) {
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
}

COLORREF capture(HWND window, const fs::path& destination) {
    RECT rect{};
    GetClientRect(window, &rect);
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
    const bool printed = PrintWindow(window, memory, PW_CLIENTONLY) != FALSE;
    const auto color = GetPixel(memory, 10, 10);
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

void visual(HWND window, const fs::path& root, std::ofstream& report) {
    accessible(window, false);
    bounds(window);
    check(capture(window, root / L"startup-dark.bmp") == RGB(25, 25, 37), "ordinary startup surface is not dark");
    const auto heading = GetDlgItem(window, 201);
    LOGFONTW font{};
    const auto handle = reinterpret_cast<HFONT>(SendMessageW(heading, WM_GETFONT, 0, 0));
    check(GetObjectW(handle, sizeof(font), &font) != 0, "native selected font unavailable");
    report << "font-observed=true\n";
    HIGHCONTRASTW before{ sizeof(HIGHCONTRASTW), 0, nullptr };
    check(SystemParametersInfoW(SPI_GETHIGHCONTRAST, sizeof(before), &before, 0) != FALSE, "high contrast unavailable");
    auto high = before;
    high.dwFlags |= HCF_HIGHCONTRASTON;
    check(SystemParametersInfoW(SPI_SETHIGHCONTRAST, sizeof(high), &high, SPIF_SENDCHANGE) != FALSE,
          "high contrast could not be enabled");
    try {
        SendMessageW(window, WM_SETTINGCHANGE, 0, 0);
        check(capture(window, root / L"startup-high-contrast.bmp") == GetSysColor(COLOR_WINDOW),
              "startup ignored high contrast");
        accessible(window, false);
    } catch (const std::exception& failure) {
        if (!SystemParametersInfoW(SPI_SETHIGHCONTRAST, sizeof(before), &before, SPIF_SENDCHANGE))
            throw std::runtime_error(std::string(failure.what()) + "; high contrast restoration failed");
        throw;
    }
    check(SystemParametersInfoW(SPI_SETHIGHCONTRAST, sizeof(before), &before, SPIF_SENDCHANGE) != FALSE,
          "high contrast could not be restored");
    SendMessageW(window, WM_SETTINGCHANGE, 0, 0);
    const auto originalDpi = GetDpiForWindow(window);
    RECT original{};
    GetWindowRect(window, &original);
    for (const UINT dpi : { 144u, 192u }) {
        RECT proposed{ original.left, original.top, original.left + MulDiv(640, dpi, 96),
                       original.top + MulDiv(340, dpi, 96) };
        SendMessageW(window, WM_DPICHANGED, MAKEWPARAM(dpi, dpi), reinterpret_cast<LPARAM>(&proposed));
        bounds(window);
        responsive(window);
    }
    SendMessageW(window, WM_DPICHANGED, MAKEWPARAM(originalDpi, originalDpi), reinterpret_cast<LPARAM>(&original));
    report << "dpi-message-cases=2;kind=emulated\n";
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
}

void calibration(proof::Observer& observer) {
    Child control;
    start(control, recap::modulePath(), L"--console-control", CREATE_NEW_CONSOLE);
    proof::until([&] { return observer.console(control.pid); }, "observer did not detect its console control");
    check(FreeConsole() != FALSE && AttachConsole(control.pid) != FALSE,
          "observer could not retain the calibration console");
    // Keep the host window alive until its asynchronous application-end event is delivered.
    try {
        control.stop();
        proof::until([&] { return observer.console(control.pid, EVENT_CONSOLE_END_APPLICATION); },
                     "observer did not detect console control exit");
    } catch (const std::exception& failure) {
        if (!FreeConsole())
            throw std::runtime_error(std::string(failure.what()) + "; calibration console detach failed");
        throw;
    }
    check(FreeConsole() != FALSE, "observer could not detach the calibration console");
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

void fixture(const std::string& id, const fs::path& root, const fs::path& native,
             const fs::path& runtime, const fs::path& source, proof::Observer& observer,
             std::vector<DWORD>& roots, std::ofstream& report, bool consoleOnly) {
    const auto layout = root / (id == "F01" ? L"fixture space \u03a9" : fs::path(id).wstring());
    fs::create_directories(layout / L"runtime");
    fs::copy_file(native, layout / L"RecapPageLauncher.exe");
    if (id != "F04") fs::copy_file(runtime, layout / L"runtime" / L"node.exe");
    if (id != "F05") fs::copy_file(source, layout / L"Launcher.mjs");
    write(layout / L"scenario.txt", id);
    SECURITY_ATTRIBUTES security{ sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE };
    recap::Handle sentinelHandle(CreateEventW(&security, TRUE, FALSE, nullptr));
    check(static_cast<bool>(sentinelHandle), "inheritable sentinel unavailable");
    if (id == "F01") {
        SetEnvironmentVariableW(L"NoDe_OpTiOnS", L"--require missing-native-fixture");
        SetEnvironmentVariableW(L"nOdE_pAtH", L"missing-native-fixture");
    }
    Child gui, coordinator, sentinel;
    start(gui, (layout / L"RecapPageLauncher.exe").wstring(), L"", 0, TRUE);
    SetEnvironmentVariableW(L"NoDe_OpTiOnS", nullptr);
    SetEnvironmentVariableW(L"nOdE_pAtH", nullptr);
    roots.push_back(gui.pid);
    observer.bindRoot(gui.pid, gui.process.get());
    proof::nativeArchitecture(gui.process.get());
    HWND window = nullptr;
    proof::until([&] { window = windowFor(gui.pid); return window != nullptr; }, "native window did not appear");
    if (id != "F04" && id != "F05") {
        proof::until([&] { return fs::exists(layout / L"observed.txt"); }, "coordinator fixture did not start");
        const auto observed = read(layout / L"observed.txt");
        const auto first = observed.find("pid=");
        check(first == 0, "fixture process identity missing");
        retain(coordinator, static_cast<DWORD>(std::stoul(observed.substr(4))), (layout / L"runtime" / L"node.exe").wstring());
        check(observed.find("arguments=true") != std::string::npos && observed.find("environment=true") != std::string::npos &&
              observed.find("cwd=true") != std::string::npos, "fixed launch arguments/environment/cwd differed");
        if (id == "F01") {
            check(!proof::hasConsole(gui.process.get(), gui.pid), "F01 GUI created a console");
            if (proof::hasConsole(coordinator.process.get(), coordinator.pid)) {
                proof::until([&] { return observer.console(coordinator.pid); },
                             "F01 console was not detected by the event observer");
                throw std::runtime_error("F01 coordinator created a console");
            }
            HANDLE duplicate = nullptr;
            if (DuplicateHandle(coordinator.process.get(), sentinelHandle.get(), GetCurrentProcess(),
                &duplicate, 0, FALSE, DUPLICATE_SAME_ACCESS)) {
                recap::Handle copied(duplicate);
                check(!sameKernelObject(sentinelHandle.get(), copied.get()), "coordinator inherited the unrelated sentinel");
            } else check(GetLastError() == ERROR_INVALID_HANDLE, "handle inheritance observation was inconclusive");
            if (!consoleOnly) visual(window, layout, report);
        }
    }
    if (id == "F09" || id == "F10") {
        proof::until([&] { return fs::exists(layout / L"sentinel.txt"); }, "detached fixture sentinel absent");
        retain(sentinel, static_cast<DWORD>(std::stoul(read(layout / L"sentinel.txt"))),
               (layout / L"runtime" / L"node.exe").wstring());
    }
    if (id == "F02" || id == "F03") {
        if (id == "F02") PostMessageW(window, WM_SYSCOMMAND, SC_CLOSE, 0);
        else SendMessageW(GetDlgItem(window, 203), BM_CLICK, 0, 0);
        proof::until([&] { return !IsWindowVisible(window); }, "pending window did not hide");
        check(gui.exit() == STILL_ACTIVE && coordinator.exit() == STILL_ACTIVE,
              "F03 pending close lost the startup owner");
    }
    if (id == "F11") {
        responsive(window);
        check(gui.exit() == STILL_ACTIVE && coordinator.exit() == STILL_ACTIVE, "EOF completed startup before child exit");
    }
    write(layout / L"continue.txt", "continue");
    const bool opened = id == "F01" || id == "F02" || id == "F09";
    if (opened) {
        proof::until([&] { return gui.exit() != STILL_ACTIVE; }, "opened fixture did not complete");
        check(gui.exit() == 0, "opened fixture failed");
    } else {
        proof::until([&] {
            check(gui.exit() == STILL_ACTIVE, id == "F03"
                ? "F03 pending close lost the startup owner" : "failure feedback owner exited early");
            return IsWindowVisible(window) && controlText(GetDlgItem(window, 203)) == L"Close";
        }, "readable error feedback did not appear", id == "F10" ? 190000 : 15000);
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
    report << "PASS " << id << "\n";
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
    proof::Observer observer;
    calibration(observer);
    write(control / L"ready.txt", "ready");
    bool dismissed = false;
    proof::until([&] {
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
                SendMessageW(GetDlgItem(window, 203), BM_CLICK, 0, 0);
                proof::until([&] { return gui.exit() != STILL_ACTIVE; }, "installed error was not dismissible");
                check(gui.exit() == 1, "installed native error exited successfully");
                dismissed = true;
                write(control / L"dismissed.txt", "dismissed");
                break;
            }
        }
        return busy ? dismissed : fs::exists(control / L"finish.txt");
    }, "installed observer deadline exceeded", 600000);
    calibration(observer);
    observer.stop();
    const auto roots = observer.registeredRoots(executable, busy ? 1 : 3, busy ? 1 : 0);
    observer.assertNoConsole(roots, !busy);
    report << "PASS installed-" << (busy ? "busy" : "functionality")
           << ";native-roots=" << roots.size() << ";console-controls=2;product-consoles=0\n";
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
    std::map<std::wstring, std::wstring> options;
    for (int index = 1; index + 1 < argc; index += 2) options[argv[index]] = argv[index + 1];
    const auto reportPath = fs::path(options[L"--report"]);
    std::ofstream report(reportPath, std::ios::binary);
    const auto com = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    try {
        check(static_cast<bool>(report), "proof report path is required");
        check(SUCCEEDED(com), "proof COM initialization failed");
        proof::nativeArchitecture(GetCurrentProcess());
        if (options[L"--mode"] == L"functionality" || options[L"--mode"] == L"busy") {
            installed(options, report);
            CoUninitialize();
            return 0;
        }
        const bool onlyDecoder = options[L"--case"] == L"N1";
        decoder(fs::path(options[L"--goldens"]), onlyDecoder);
        if (onlyDecoder) { report << "PASS N1 baseline\n"; CoUninitialize(); return 0; }
        supervision();
        const fs::path root(options[L"--root"]);
        fs::create_directories(root);
        preflight(root, options[L"--launcher"]);
        proof::Observer observer;
        calibration(observer);
        std::vector<DWORD> roots;
        const std::wstring only = options[L"--case"];
        for (int index = 1; index <= 11; ++index) {
            const auto id = std::string("F") + (index < 10 ? "0" : "") + std::to_string(index);
            if (!only.empty() && only != std::wstring(id.begin(), id.end())) continue;
            fixture(id, root, options[L"--launcher"], options[L"--runtime"], options[L"--fixture"],
                    observer, roots, report, options[L"--console-only"] == L"true");
        }
        calibration(observer);
        observer.stop();
        observer.assertNoConsole(roots, false);
        report << "PASS observer;console-controls=2\n";
        CoUninitialize();
        return 0;
    } catch (const std::exception& failure) {
        report << "FAIL " << failure.what() << "\n";
        if (SUCCEEDED(com)) CoUninitialize();
        return 1;
    }
}
