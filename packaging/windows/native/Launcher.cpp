#include "StartupProcess.h"
#include "StartupProtocol.h"
#include <commctrl.h>
#include <windowsx.h>
#include <wincodec.h>
#include <atomic>
#include <cmath>
#include <iterator>
#include <memory>
#include <mutex>
#include <thread>

namespace {
constexpr wchar_t WindowClass[] = L"RecapPageStartupWindow";
constexpr UINT CompleteMessage = WM_APP + 1;
constexpr int HeadingId = 201, StatusId = 202, CloseId = 203, DetailId = 204, FooterId = 205;

struct PipeWork {
    recap::Handle output, diagnostics, done;
    std::atomic<bool> stop{ false }, finalize{ false };
    std::atomic<DWORD> error{ ERROR_SUCCESS };
    recap::Capture capture;
};

void ioError(PipeWork& work, DWORD code) {
    DWORD expected = ERROR_SUCCESS;
    work.error.compare_exchange_strong(expected, code);
}

void closePipe(PipeWork& work, recap::Handle& handle) {
    const auto error = handle.close();
    if (error != ERROR_SUCCESS) ioError(work, error);
}

DWORD available(PipeWork& work, recap::Handle& pipe) {
    if (!pipe) return 0;
    DWORD count = 0;
    if (!PeekNamedPipe(pipe.get(), nullptr, 0, nullptr, &count, nullptr)) {
        const auto error = GetLastError();
        if (error != ERROR_BROKEN_PIPE) ioError(work, error);
        closePipe(work, pipe);
        return 0;
    }
    return count;
}

void drain(PipeWork& work, recap::Handle& pipe, bool diagnostic, bool final) {
    DWORD remaining = available(work, pipe);
    auto& bytes = diagnostic ? work.capture.diagnostics : work.capture.output;
    auto& overflow = diagnostic ? work.capture.diagnosticOverflow : work.capture.outputOverflow;
    const size_t limit = diagnostic ? recap::DiagnosticLimit : recap::FrameLimit + 1;
    if (final && remaining > limit - bytes.size()) {
        overflow = true;
        remaining = static_cast<DWORD>(limit - bytes.size());
    }
    unsigned int chunks = 0;
    while (remaining && pipe && !work.stop.load() && (final || chunks < 4)) {
        unsigned char buffer[4096];
        const DWORD requested = std::min(remaining, static_cast<DWORD>(sizeof(buffer)));
        DWORD count = 0;
        if (!ReadFile(pipe.get(), buffer, requested, &count, nullptr)) {
            const auto error = GetLastError();
            if (error != ERROR_BROKEN_PIPE) ioError(work, error);
            closePipe(work, pipe);
            return;
        }
        if (!count) { closePipe(work, pipe); return; }
        recap::appendBounded(bytes, buffer, count, limit, overflow);
        remaining -= count;
        ++chunks;
    }
}

void readPipes(const std::shared_ptr<PipeWork>& work) {
    try {
        while (!work->stop.load()) {
            const bool final = work->finalize.load();
            drain(*work, work->output, false, final);
            drain(*work, work->diagnostics, true, final);
            if (final || work->error.load() || (!work->output && !work->diagnostics)) break;
            if (!available(*work, work->output) && !available(*work, work->diagnostics))
                Sleep(20);
        }
    } catch (const std::bad_alloc&) {
        ioError(*work, ERROR_NOT_ENOUGH_MEMORY);
    }
    closePipe(*work, work->output);
    closePipe(*work, work->diagnostics);
    if (!SetEvent(work->done.get())) ioError(*work, GetLastError());
}

struct Attributes {
    std::vector<unsigned char> bytes;
    LPPROC_THREAD_ATTRIBUTE_LIST list = nullptr;
    explicit Attributes(HANDLE (&handles)[3]) {
        SIZE_T size = 0;
        InitializeProcThreadAttributeList(nullptr, 1, 0, &size);
        if (!size) throw recap::WindowsFailure(L"Startup handle isolation could not be initialized", GetLastError());
        bytes.resize(size);
        auto* candidate = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(bytes.data());
        recap::require(InitializeProcThreadAttributeList(candidate, 1, 0, &size),
            L"Startup handle isolation could not be initialized");
        list = candidate;
        if (!UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                        handles, sizeof(handles), nullptr, nullptr)) {
            const auto error = GetLastError();
            DeleteProcThreadAttributeList(list);
            list = nullptr;
            throw recap::WindowsFailure(L"Startup handles could not be isolated", error);
        }
    }
    ~Attributes() { if (list) DeleteProcThreadAttributeList(list); }
};

struct Operations {
    recap::Handle& process;
    recap::Handle& thread;
    std::shared_ptr<PipeWork> work;
    uint64_t now() const { return GetTickCount64(); }
    recap::ProcessState processState() const {
        const auto state = WaitForSingleObject(process.get(), 0);
        if (state == WAIT_OBJECT_0) return recap::ProcessState::exited;
        if (state == WAIT_TIMEOUT) return recap::ProcessState::running;
        ioError(*work, GetLastError());
        return recap::ProcessState::unreadable;
    }
    bool workerDone() const { return WaitForSingleObject(work->done.get(), 0) == WAIT_OBJECT_0; }
    bool ioFailed() const { return work->error.load() != ERROR_SUCCESS; }
    void finalizeIo() { work->finalize.store(true); }
    void stopIo() { work->stop.store(true); }
    bool terminateOwned() { return TerminateProcess(process.get(), 1) != FALSE; }
    void cancelIo() {
        if (thread && !CancelSynchronousIo(thread.get())) {
            const auto error = GetLastError();
            if (error != ERROR_NOT_FOUND) ioError(*work, error);
        }
    }
    void wait(DWORD delay) {
        const HANDLE handle = processState() == recap::ProcessState::exited
            ? work->done.get() : process.get();
        if (WaitForSingleObject(handle, delay) == WAIT_FAILED) Sleep(delay);
    }
};

recap::Outcome runCoordinator(const std::wstring& arguments) {
    const auto paths = recap::launchPaths(recap::modulePath(), arguments);
    auto work = std::make_shared<PipeWork>();
    work->done = recap::Handle(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    recap::require(static_cast<BOOL>(static_cast<bool>(work->done)), L"Startup completion could not be observed");
    SECURITY_ATTRIBUTES security{ sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE };
    recap::Handle outWriter, errorWriter;
    const auto pipe = [&](recap::Handle& reader, recap::Handle& writer) {
        HANDLE read = nullptr, write = nullptr;
        recap::require(CreatePipe(&read, &write, &security, 0), L"A startup pipe could not be created");
        reader = recap::Handle(read);
        writer = recap::Handle(write);
        recap::require(SetHandleInformation(read, HANDLE_FLAG_INHERIT, 0),
                       L"A startup pipe could not be isolated");
    };
    pipe(work->output, outWriter);
    pipe(work->diagnostics, errorWriter);
    recap::Handle input(CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                                   &security, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    recap::require(static_cast<BOOL>(static_cast<bool>(input)), L"Startup input could not be opened");
    HANDLE inherited[] = { input.get(), outWriter.get(), errorWriter.get() };
    Attributes attributes(inherited);
    STARTUPINFOEXW startup{};
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = input.get();
    startup.StartupInfo.hStdOutput = outWriter.get();
    startup.StartupInfo.hStdError = errorWriter.get();
    startup.lpAttributeList = attributes.list;
    auto command = recap::coordinatorCommand(paths);
    auto environment = recap::childEnvironment();
    PROCESS_INFORMATION created{};
    recap::require(CreateProcessW(paths.runtime.c_str(), command.data(), nullptr, nullptr, TRUE,
        recap::CoordinatorFlags, environment.data(), paths.root.c_str(), &startup.StartupInfo, &created),
        L"The packaged startup coordinator could not be started");
    const auto started = GetTickCount64();
    recap::Handle process(created.hProcess), primaryThread(created.hThread);
    for (auto* handle : { &outWriter, &errorWriter, &input, &primaryThread }) {
        const auto error = handle->close();
        if (error) ioError(*work, error);
    }
    recap::Handle workerHandle;
    std::thread worker;
    try {
        worker = std::thread([work] { readPipes(work); });
    } catch (const std::system_error&) {
        ioError(*work, ERROR_NOT_ENOUGH_MEMORY);
        closePipe(*work, work->output);
        closePipe(*work, work->diagnostics);
        SetEvent(work->done.get());
    }
    if (worker.joinable()) {
        HANDLE duplicate = nullptr;
        if (!DuplicateHandle(GetCurrentProcess(), worker.native_handle(), GetCurrentProcess(),
                             &duplicate, 0, FALSE, DUPLICATE_SAME_ACCESS))
            ioError(*work, GetLastError());
        workerHandle = recap::Handle(duplicate);
        worker.detach();
    }
    Operations operations{ process, workerHandle, work };
    const auto observation = recap::supervise(operations, started);
    DWORD exitCode = 0;
    const bool exitKnown = observation.processExited && GetExitCodeProcess(process.get(), &exitCode);
    recap::Outcome outcome = observation.workerDone
        ? recap::interpret(work->capture, exitKnown, exitCode, work->error.load())
        : recap::Outcome{ false, L"Recap Page could not finish observing its startup output." };
    if (observation.failed) {
        if (outcome.detail.empty()) outcome.detail = L"Recap Page could not confirm startup.";
        outcome.opened = false;
        if (observation.timedOut) outcome.detail += L"\nStartup observation timed out.";
        if (observation.cleanupUncertain)
            outcome.detail += L"\nStartup cleanup could not be confirmed; the browser may still open later.";
        outcome.detail += L"\nIf the app is running, open http://127.0.0.1:8787/ in your browser.";
    }
    return outcome;
}

template<class T> struct Com {
    T* value = nullptr;
    ~Com() { if (value) value->Release(); }
    T** put() { return &value; }
    T* operator->() { return value; }
};

void requireCom(HRESULT result, const wchar_t* role) {
    if (FAILED(result)) throw recap::WindowsFailure(role, static_cast<DWORD>(result));
}

HBITMAP loadIcon(HINSTANCE instance) {
    const auto resource = FindResourceW(instance, MAKEINTRESOURCEW(101), RT_RCDATA);
    if (!resource) throw recap::WindowsFailure(L"The app icon is missing", GetLastError());
    const auto size = SizeofResource(instance, resource);
    const auto loaded = LoadResource(instance, resource);
    auto* bytes = static_cast<BYTE*>(LockResource(loaded));
    if (!bytes || size == 0 || size > 4 * 1024 * 1024)
        throw recap::WindowsFailure(L"The app icon could not be read", ERROR_INVALID_DATA);
    Com<IWICImagingFactory> factory;
    requireCom(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(factory.put())), L"The app icon decoder could not be started");
    Com<IWICStream> stream;
    requireCom(factory->CreateStream(stream.put()), L"The app icon stream could not be created");
    requireCom(stream->InitializeFromMemory(bytes, size), L"The app icon stream could not be read");
    Com<IWICBitmapDecoder> decoder;
    requireCom(factory->CreateDecoderFromStream(stream.value, nullptr, WICDecodeMetadataCacheOnLoad,
        decoder.put()), L"The app icon could not be decoded");
    Com<IWICBitmapFrameDecode> frame;
    requireCom(decoder->GetFrame(0, frame.put()), L"The app icon frame could not be read");
    UINT width = 0, height = 0;
    requireCom(frame->GetSize(&width, &height), L"The app icon size could not be read");
    if (width != 512 || height != 512)
        throw recap::WindowsFailure(L"The app icon has an invalid size", ERROR_INVALID_DATA);
    Com<IWICFormatConverter> converter;
    requireCom(factory->CreateFormatConverter(converter.put()), L"The app icon colors could not be prepared");
    requireCom(converter->Initialize(frame.value, GUID_WICPixelFormat32bppPBGRA,
        WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom),
        L"The app icon colors could not be decoded");
    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = 512;
    info.bmiHeader.biHeight = -512;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    void* pixels = nullptr;
    const auto bitmap = CreateDIBSection(nullptr, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
    if (!bitmap) throw recap::WindowsFailure(L"The app icon bitmap could not be created", GetLastError());
    const auto copied = converter->CopyPixels(nullptr, 512 * 4, 512 * 512 * 4, static_cast<BYTE*>(pixels));
    if (FAILED(copied)) {
        DeleteObject(bitmap);
        requireCom(copied, L"The app icon pixels could not be decoded");
    }
    return bitmap;
}

struct App {
    HWND window = nullptr, heading = nullptr, status = nullptr, close = nullptr, detail = nullptr, footer = nullptr;
    HBITMAP icon = nullptr;
    HFONT uiFont = nullptr, wordFont = nullptr;
    HBRUSH background = nullptr;
    UINT dpi = 96;
    int wordSize = 46;
    RECT iconRect{};
    COLORREF surface = RGB(25, 25, 37), foreground = RGB(242, 242, 248);
    bool highContrast = false, failed = false, terminal = false;
    int exitCode = 1;
    std::wstring face = L"Segoe UI";
    recap::Handle completed;
    std::mutex resultMutex;
    recap::Outcome result;
    recap::Publication publication;
    ~App() {
        if (window && IsWindow(window)) DestroyWindow(window);
        if (icon) DeleteObject(icon);
        if (uiFont) DeleteObject(uiFont);
        if (wordFont) DeleteObject(wordFont);
        if (background) DeleteObject(background);
    }
    int scale(int value) const { return MulDiv(value, static_cast<int>(dpi), 96); }
};

int CALLBACK foundFont(const LOGFONTW*, const TEXTMETRICW*, DWORD, LPARAM value) {
    *reinterpret_cast<bool*>(value) = true;
    return 0;
}

void chooseFont(App& app, HDC dc) {
    for (const auto* face : { L"Impact", L"Haettenschweiler", L"Arial Narrow Bold", L"Segoe UI" }) {
        LOGFONTW query{};
        query.lfCharSet = DEFAULT_CHARSET;
        lstrcpynW(query.lfFaceName, face, LF_FACESIZE);
        bool found = false;
        EnumFontFamiliesExW(dc, &query, foundFont, reinterpret_cast<LPARAM>(&found), 0);
        if (found) { app.face = face; return; }
    }
}

HFONT font(const App& app, int size, bool heading) {
    return CreateFontW(-app.scale(size), 0, 0, 0, heading ? FW_HEAVY : FW_NORMAL,
        FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
        CLEARTYPE_QUALITY, DEFAULT_PITCH, heading ? app.face.c_str() : L"Segoe UI");
}

SIZE wordExtent(App& app, HDC dc) {
    const auto old = SelectObject(dc, app.wordFont);
    SetTextCharacterExtra(dc, app.scale(std::max(1, static_cast<int>(std::lround(app.wordSize * .035)))));
    SIZE size{};
    GetTextExtentPoint32W(dc, L"RECAP PAGE!", 11, &size);
    SetTextCharacterExtra(dc, 0);
    SelectObject(dc, old);
    size.cx += static_cast<LONG>(std::ceil(size.cy * .13)) + app.scale(14);
    size.cy += static_cast<LONG>(std::ceil(size.cx * .02)) + app.scale(14);
    return size;
}

void layout(App& app) {
    RECT client{};
    GetClientRect(app.window, &client);
    const int width = client.right, height = client.bottom;
    const int padding = app.scale(22);
    const int iconSize = app.scale(app.failed ? 64 : (width >= app.scale(500) ? 136 : 76));
    const int gap = app.scale(width >= app.scale(500) ? 32 : 16);
    const int maximumWord = std::max(app.scale(90), width - padding * 2 - gap - iconSize);
    HDC dc = GetDC(app.window);
    SIZE word{};
    for (int size = 46; size >= 16; --size) {
        if (app.wordFont) DeleteObject(app.wordFont);
        app.wordSize = size;
        app.wordFont = font(app, size, true);
        word = wordExtent(app, dc);
        if (word.cx <= maximumWord) break;
    }
    ReleaseDC(app.window, dc);
    SendMessageW(app.heading, WM_SETFONT, reinterpret_cast<WPARAM>(app.wordFont), FALSE);
    const int column = std::min(static_cast<int>(word.cx), maximumWord);
    const int row = std::max(iconSize, static_cast<int>(word.cy) + app.scale(46));
    const int startX = std::max(padding, (width - iconSize - gap - column) / 2);
    const int startY = app.failed ? app.scale(42)
        : std::max(app.scale(48), (height - app.scale(56) - row) / 2);
    app.iconRect = { startX, startY + (row - iconSize) / 2,
                     startX + iconSize, startY + (row + iconSize) / 2 };
    MoveWindow(app.heading, startX + iconSize + gap, startY, column, word.cy, TRUE);
    MoveWindow(app.status, startX + iconSize + gap, startY + word.cy + app.scale(8),
               column, app.scale(40), TRUE);
    MoveWindow(app.close, std::max(0, width - app.scale(48)), 0, app.scale(48), app.scale(40), TRUE);
    const int footerY = std::max(app.scale(40), height - app.scale(48));
    MoveWindow(app.footer, padding, footerY + app.scale(10), std::max(1, width - padding * 2), app.scale(36), TRUE);
    const int detailY = startY + row + app.scale(12);
    MoveWindow(app.detail, padding, detailY, std::max(1, width - padding * 2),
               std::max(app.scale(40), footerY - detailY - app.scale(12)), TRUE);
    InvalidateRect(app.window, nullptr, TRUE);
}

void appearance(App& app) {
    HIGHCONTRASTW high{ sizeof(HIGHCONTRASTW), 0, nullptr };
    app.highContrast = SystemParametersInfoW(SPI_GETHIGHCONTRAST, sizeof(high), &high, 0)
        && (high.dwFlags & HCF_HIGHCONTRASTON);
    app.surface = app.highContrast ? GetSysColor(COLOR_WINDOW) : RGB(25, 25, 37);
    app.foreground = app.highContrast ? GetSysColor(COLOR_WINDOWTEXT) : RGB(242, 242, 248);
    if (app.background) DeleteObject(app.background);
    app.background = CreateSolidBrush(app.surface);
    if (app.uiFont) DeleteObject(app.uiFont);
    app.uiFont = font(app, 14, false);
    for (const auto control : { app.status, app.close, app.detail, app.footer })
        SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(app.uiFont), TRUE);
    layout(app);
}

void drawHeading(App& app, const DRAWITEMSTRUCT& item) {
    const auto dc = item.hDC;
    const int saved = SaveDC(dc);
    FillRect(dc, &item.rcItem, app.background);
    SelectObject(dc, app.wordFont);
    SetBkMode(dc, TRANSPARENT);
    SetTextCharacterExtra(dc, app.scale(std::max(1, static_cast<int>(std::lround(app.wordSize * .035)))));
    const double angle = -.0174532925199433, shear = -.105104235265676;
    XFORM transform{};
    transform.eM11 = static_cast<FLOAT>(std::cos(angle) + shear * std::sin(angle));
    transform.eM12 = static_cast<FLOAT>(std::sin(angle));
    transform.eM21 = static_cast<FLOAT>(-std::sin(angle) + shear * std::cos(angle));
    transform.eM22 = static_cast<FLOAT>(std::cos(angle));
    transform.eDx = static_cast<FLOAT>(app.scale(7));
    transform.eDy = static_cast<FLOAT>(app.scale(7));
    SetGraphicsMode(dc, GM_ADVANCED);
    const auto draw = [&](COLORREF fill, bool shadow) {
        auto position = transform;
        if (shadow) {
            position.eDx += static_cast<FLOAT>(app.scale(4));
            position.eDy += static_cast<FLOAT>(app.scale(4));
        }
        SetWorldTransform(dc, &position);
        BeginPath(dc);
        TextOutW(dc, 0, 0, L"RECAP PAGE!", 11);
        EndPath(dc);
        const auto brush = CreateSolidBrush(fill);
        const auto pen = CreatePen(PS_SOLID, std::max(1, app.scale(1)),
                                  app.highContrast || shadow ? fill : RGB(255, 255, 255));
        const auto oldBrush = SelectObject(dc, brush), oldPen = SelectObject(dc, pen);
        StrokeAndFillPath(dc);
        SelectObject(dc, oldBrush);
        SelectObject(dc, oldPen);
        DeleteObject(brush);
        DeleteObject(pen);
    };
    if (!app.highContrast) draw(RGB(138, 83, 225), true);
    draw(app.highContrast ? app.foreground : RGB(127, 179, 255), false);
    RestoreDC(dc, saved);
}

LRESULT CALLBACK headingProcedure(HWND window, UINT message, WPARAM wparam, LPARAM lparam,
                                  UINT_PTR id, DWORD_PTR data) {
    if (message == WM_PAINT || message == WM_PRINTCLIENT) {
        PAINTSTRUCT paint{};
        DRAWITEMSTRUCT item{};
        item.hDC = message == WM_PAINT ? BeginPaint(window, &paint) : reinterpret_cast<HDC>(wparam);
        GetClientRect(window, &item.rcItem);
        drawHeading(*reinterpret_cast<App*>(data), item);
        if (message == WM_PAINT) EndPaint(window, &paint);
        return 0;
    }
    if (message == WM_NCDESTROY) RemoveWindowSubclass(window, headingProcedure, id);
    return DefSubclassProc(window, message, wparam, lparam);
}

void drawClose(App& app, const DRAWITEMSTRUCT& item) {
    FillRect(item.hDC, &item.rcItem, app.background);
    const auto pen = CreatePen(PS_SOLID, std::max(1, app.scale(1)), app.foreground);
    const auto old = SelectObject(item.hDC, pen);
    const int centerX = (item.rcItem.left + item.rcItem.right) / 2;
    const int centerY = (item.rcItem.top + item.rcItem.bottom) / 2;
    const int half = app.scale(5);
    MoveToEx(item.hDC, centerX - half, centerY - half, nullptr);
    LineTo(item.hDC, centerX + half + 1, centerY + half + 1);
    MoveToEx(item.hDC, centerX + half, centerY - half, nullptr);
    LineTo(item.hDC, centerX - half - 1, centerY + half + 1);
    SelectObject(item.hDC, old);
    DeleteObject(pen);
    if (item.itemState & ODS_FOCUS) {
        auto focus = item.rcItem;
        InflateRect(&focus, -app.scale(5), -app.scale(5));
        DrawFocusRect(item.hDC, &focus);
    }
}

bool clampWindow(RECT& rectangle, HMONITOR selected = nullptr);

bool placeFailureWindow(App& app) {
    const auto monitor = MonitorFromWindow(app.window, MONITOR_DEFAULTTONEAREST);
    if (!monitor) {
        SetLastError(ERROR_INVALID_MONITOR_HANDLE);
        return false;
    }
    RECT rectangle{};
    if (!GetWindowRect(app.window, &rectangle)) return false;
    rectangle.right = rectangle.left + app.scale(640);
    rectangle.bottom = rectangle.top + app.scale(520);
    if (!clampWindow(rectangle, monitor)) return false;
    return SetWindowPos(app.window, nullptr, rectangle.left, rectangle.top,
        rectangle.right - rectangle.left, rectangle.bottom - rectangle.top, SWP_NOZORDER) != FALSE;
}

void showFailure(App& app, const std::wstring& message) {
    app.terminal = true;
    app.failed = true;
    app.exitCode = 1;
    SetWindowTextW(app.window, L"Recap Page startup error");
    SetWindowTextW(app.status, L"Startup could not be confirmed.");
    SetWindowTextW(app.close, L"Close");
    SetWindowTextW(app.footer, L"Close this window after reading the error.");
    std::wstring text;
    for (const auto c : message) { if (c == L'\n') text += L'\r'; text += c; }
    SetWindowTextW(app.detail, text.c_str());
    ShowWindow(app.detail, SW_SHOW);
    std::wstring placementError;
    if (!placeFailureWindow(app)) {
        placementError = recap::windowsError(L"The error window could not be placed on this display", GetLastError());
        text += L"\r\n\r\n" + placementError;
        SetWindowTextW(app.detail, text.c_str());
    }
    layout(app);
    ShowWindow(app.window, SW_SHOWNORMAL);
    if (!SetForegroundWindow(app.window)) {
        FLASHWINFO flash{ sizeof(FLASHWINFO), app.window, FLASHW_TRAY, 3, 0 };
        FlashWindowEx(&flash);
    }
    SetFocus(app.close);
    RedrawWindow(app.window, nullptr, nullptr, RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN);
    NotifyWinEvent(EVENT_OBJECT_NAMECHANGE, app.status, OBJID_CLIENT, CHILDID_SELF);
    NotifyWinEvent(EVENT_OBJECT_VALUECHANGE, app.detail, OBJID_CLIENT, CHILDID_SELF);
    if (!placementError.empty())
        MessageBoxW(nullptr, text.c_str(), L"Recap Page startup error", MB_OK | MB_ICONERROR);
}

bool clampWindow(RECT& rectangle, HMONITOR selected) {
    MONITORINFO monitor{ sizeof(MONITORINFO) };
    const auto target = selected ? selected : MonitorFromRect(&rectangle, MONITOR_DEFAULTTONEAREST);
    if (!GetMonitorInfoW(target, &monitor)) return false;
    const LONG width = std::min(rectangle.right - rectangle.left, monitor.rcWork.right - monitor.rcWork.left);
    const LONG height = std::min(rectangle.bottom - rectangle.top, monitor.rcWork.bottom - monitor.rcWork.top);
    rectangle.left = std::max(monitor.rcWork.left, std::min(rectangle.left, monitor.rcWork.right - width));
    rectangle.top = std::max(monitor.rcWork.top, std::min(rectangle.top, monitor.rcWork.bottom - height));
    rectangle.right = rectangle.left + width;
    rectangle.bottom = rectangle.top + height;
    return true;
}

void drawClient(App& app, HDC dc, const RECT& rectangle) {
    FillRect(dc, &rectangle, app.background);
    if (app.icon) {
        const auto source = CreateCompatibleDC(dc);
        if (!source) {
            SetWindowTextW(app.footer, L"The app icon could not be drawn. Startup is still being observed.");
            return;
        }
        const auto old = SelectObject(source, app.icon);
        const auto& box = app.iconRect;
        BLENDFUNCTION blend{ AC_SRC_OVER, 0, 255, AC_SRC_ALPHA };
        AlphaBlend(dc, box.left, box.top, box.right - box.left, box.bottom - box.top,
                   source, 0, 0, 512, 512, blend);
        SelectObject(source, old);
        DeleteDC(source);
    }
}

LRESULT CALLBACK windowProcedure(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    auto* app = reinterpret_cast<App*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
        app = static_cast<App*>(reinterpret_cast<CREATESTRUCTW*>(lparam)->lpCreateParams);
        app->window = window;
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(app));
    }
    if (!app) return DefWindowProcW(window, message, wparam, lparam);
    switch (message) {
    case WM_CLOSE:
        if (!app->terminal) { ShowWindow(window, SW_HIDE); return 0; }
        DestroyWindow(window);
        return 0;
    case WM_COMMAND:
        if (LOWORD(wparam) == CloseId || LOWORD(wparam) == IDCANCEL) {
            SendMessageW(window, WM_CLOSE, 0, 0);
            return 0;
        }
        break;
    case WM_SIZE:
        if (app->heading) layout(*app);
        return 0;
    case WM_DPICHANGED: {
        auto proposed = *reinterpret_cast<const RECT*>(lparam);
        if (!clampWindow(proposed)) {
            SetWindowTextW(app->footer, L"The display area could not be read. The window position was kept.");
            return 0;
        }
        app->dpi = HIWORD(wparam);
        SetWindowPos(window, nullptr, proposed.left, proposed.top,
                     proposed.right - proposed.left, proposed.bottom - proposed.top,
                     SWP_NOZORDER | SWP_NOACTIVATE);
        appearance(*app);
        return 0;
    }
    case WM_SETTINGCHANGE:
    case WM_THEMECHANGED:
        if (app->heading) appearance(*app);
        return 0;
    case WM_NCHITTEST: {
        const auto normal = DefWindowProcW(window, message, wparam, lparam);
        POINT point{ GET_X_LPARAM(lparam), GET_Y_LPARAM(lparam) };
        ScreenToClient(window, &point);
        RECT client{};
        GetClientRect(window, &client);
        if (normal == HTCLIENT && point.y < app->scale(40) &&
            point.x < client.right - app->scale(48)) return HTCAPTION;
        return normal;
    }
    case WM_GETMINMAXINFO: {
        auto* limits = reinterpret_cast<MINMAXINFO*>(lparam);
        MONITORINFO monitor{ sizeof(MONITORINFO) };
        GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST), &monitor);
        limits->ptMinTrackSize = {
            std::min(app->scale(300), static_cast<int>(monitor.rcWork.right - monitor.rcWork.left)),
            std::min(app->scale(app->failed ? 400 : 280), static_cast<int>(monitor.rcWork.bottom - monitor.rcWork.top))
        };
        return 0;
    }
    case WM_CTLCOLORSTATIC:
    case WM_CTLCOLOREDIT:
        SetTextColor(reinterpret_cast<HDC>(wparam), app->highContrast ? app->foreground
            : reinterpret_cast<HWND>(lparam) == app->footer ? RGB(169, 169, 190)
            : reinterpret_cast<HWND>(lparam) == app->status ? RGB(199, 199, 216) : app->foreground);
        SetBkColor(reinterpret_cast<HDC>(wparam), app->surface);
        return reinterpret_cast<LRESULT>(app->background);
    case WM_DRAWITEM: {
        const auto& item = *reinterpret_cast<DRAWITEMSTRUCT*>(lparam);
        if (item.CtlID == HeadingId) drawHeading(*app, item);
        else if (item.CtlID == CloseId) drawClose(*app, item);
        return TRUE;
    }
    case WM_PAINT: {
        PAINTSTRUCT paint{};
        const auto dc = BeginPaint(window, &paint);
        drawClient(*app, dc, paint.rcPaint);
        EndPaint(window, &paint);
        return 0;
    }
    case WM_PRINTCLIENT: {
        RECT client{};
        GetClientRect(window, &client);
        drawClient(*app, reinterpret_cast<HDC>(wparam), client);
        return 0;
    }
    case CompleteMessage:
        SetEvent(app->completed.get());
        return 0;
    case WM_DESTROY:
        PostQuitMessage(app->exitCode);
        return 0;
    }
    return DefWindowProcW(window, message, wparam, lparam);
}

void publish(const std::shared_ptr<App>& app, recap::Outcome result) {
    if (!app->publication.claim()) return;
    {
        std::lock_guard<std::mutex> lock(app->resultMutex);
        app->result = std::move(result);
    }
    if (!SetEvent(app->completed.get())) PostMessageW(app->window, CompleteMessage, 0, 0);
}
} // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR arguments, int) {
    const auto com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    try {
        auto app = std::make_shared<App>();
        app->completed = recap::Handle(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        recap::require(static_cast<BOOL>(static_cast<bool>(app->completed)), L"Startup feedback could not be initialized");
        app->background = CreateSolidBrush(app->surface);
        INITCOMMONCONTROLSEX controls{ sizeof(controls), ICC_STANDARD_CLASSES };
        recap::require(InitCommonControlsEx(&controls), L"Startup controls could not be initialized");
        WNDCLASSEXW windowClass{};
        windowClass.cbSize = sizeof(windowClass);
        windowClass.lpfnWndProc = windowProcedure;
        windowClass.hInstance = instance;
        windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        windowClass.lpszClassName = WindowClass;
        recap::require(RegisterClassExW(&windowClass), L"Startup feedback could not be registered");
        RECT work{};
        recap::require(SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0),
                       L"The display work area could not be read");
        const int width = std::min(640, static_cast<int>(work.right - work.left));
        const int height = std::min(340, static_cast<int>(work.bottom - work.top));
        app->window = CreateWindowExW(WS_EX_APPWINDOW | WS_EX_CONTROLPARENT, WindowClass, L"Recap Page startup",
            WS_POPUP | WS_THICKFRAME | WS_SYSMENU, work.left + (work.right - work.left - width) / 2,
            work.top + (work.bottom - work.top - height) / 2, width, height, nullptr, nullptr, instance, app.get());
        recap::require(app->window != nullptr, L"Startup feedback could not be created");
        const auto makeControl = [&](const wchar_t* type, const wchar_t* text, DWORD style, int id) {
            const auto control = CreateWindowExW(0, type, text, WS_CHILD | WS_VISIBLE | style,
                0, 0, 1, 1, app->window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)), instance, nullptr);
            recap::require(control != nullptr, L"A startup control could not be created");
            return control;
        };
        app->heading = makeControl(L"STATIC", L"RECAP PAGE!", SS_LEFT, HeadingId);
        recap::require(SetWindowSubclass(app->heading, headingProcedure, 1,
            reinterpret_cast<DWORD_PTR>(app.get())), L"The startup heading could not be prepared");
        app->status = makeControl(L"STATIC", L"Opening your reading tracker...", SS_LEFT, StatusId);
        app->close = makeControl(L"BUTTON", L"Hide startup window", BS_OWNERDRAW | WS_TABSTOP, CloseId);
        app->detail = makeControl(L"EDIT", L"", ES_READONLY | ES_MULTILINE | ES_AUTOVSCROLL |
            WS_VSCROLL | WS_TABSTOP, DetailId);
        SendMessageW(app->detail, EM_SETLIMITTEXT, 256 * 1024, 0);
        ShowWindow(app->detail, SW_HIDE);
        app->footer = makeControl(L"STATIC", L"Closing this window lets startup continue in the background.",
                                  SS_LEFT, FooterId);
        app->dpi = GetDpiForWindow(app->window);
        const int scaledWidth = std::min(app->scale(640), static_cast<int>(work.right - work.left));
        const int scaledHeight = std::min(app->scale(340), static_cast<int>(work.bottom - work.top));
        SetWindowPos(app->window, nullptr, work.left + (work.right - work.left - scaledWidth) / 2,
                     work.top + (work.bottom - work.top - scaledHeight) / 2,
                     scaledWidth, scaledHeight, SWP_NOZORDER | SWP_NOACTIVATE);
        const auto dc = GetDC(app->window);
        chooseFont(*app, dc);
        ReleaseDC(app->window, dc);
        appearance(*app);
        std::wstring resourceError;
        try {
            requireCom(com, L"The app icon services could not be initialized");
            app->icon = loadIcon(instance);
        } catch (const recap::WindowsFailure& failure) {
            resourceError = failure.detail;
        }
        ShowWindow(app->window, SW_SHOW);
        UpdateWindow(app->window);
        SetFocus(app->close);
        if (!resourceError.empty()) {
            showFailure(*app, resourceError);
        } else {
            const std::wstring command(arguments ? arguments : L"");
            try {
                std::thread([app, command] {
                    try { publish(app, runCoordinator(command)); }
                    catch (const recap::WindowsFailure& failure) { publish(app, { false, failure.detail }); }
                    catch (const std::exception&) {
                        publish(app, { false, L"Recap Page could not prepare startup. Try starting the app again." });
                    }
                }).detach();
            } catch (const std::system_error&) {
                showFailure(*app, L"Recap Page could not create its startup worker. Try starting the app again.");
            }
        }
        bool finished = false;
        while (!finished) {
            const HANDLE completed = app->completed.get();
            const auto wait = MsgWaitForMultipleObjects(1, &completed, FALSE, INFINITE, QS_ALLINPUT);
            if (wait == WAIT_FAILED) {
                const auto detail = recap::windowsError(L"Startup feedback could not continue", GetLastError());
                MessageBoxW(app->window, detail.c_str(), L"Recap Page startup error", MB_OK | MB_ICONERROR);
                app->exitCode = 1;
                DestroyWindow(app->window);
                break;
            }
            MSG message{};
            while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
                if (message.message == WM_QUIT) { finished = true; break; }
                if (message.message == WM_KEYDOWN && (message.wParam == VK_ESCAPE ||
                    (message.wParam == VK_RETURN && GetFocus() == app->close)))
                    SendMessageW(app->window, WM_CLOSE, 0, 0);
                else if (!IsDialogMessageW(app->window, &message)) {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
            // A close queued while pending must hide feedback, not dismiss an unseen later error.
            if (!finished && WaitForSingleObject(completed, 0) == WAIT_OBJECT_0) {
                ResetEvent(completed);
                recap::Outcome result;
                { std::lock_guard<std::mutex> lock(app->resultMutex); result = app->result; }
                if (result.opened) {
                    app->terminal = true;
                    app->exitCode = 0;
                    DestroyWindow(app->window);
                } else {
                    showFailure(*app, result.detail);
                }
            }
        }
        if (SUCCEEDED(com)) CoUninitialize();
        return app->exitCode;
    } catch (const recap::WindowsFailure& failure) {
        MessageBoxW(nullptr, failure.detail.c_str(), L"Recap Page startup error", MB_OK | MB_ICONERROR);
    } catch (const std::exception&) {
        MessageBoxW(nullptr, L"Recap Page could not create its startup feedback. Try starting the app again.",
                    L"Recap Page startup error", MB_OK | MB_ICONERROR);
    }
    if (SUCCEEDED(com)) CoUninitialize();
    return 1;
}
