#include <windows.h>
#include <shlwapi.h>
#include <shellapi.h>
#include <shobjidl.h>
#include <wrl.h>
#include <wrl/event.h>
#include <WebView2.h>
#include <algorithm>
#include <filesystem>
#include <fstream>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>
#include "PrototypeConfig.generated.h"

namespace {
using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
using namespace std::literals;

constexpr wchar_t WindowClass[] = L"RecapPageWebViewPrototype";
constexpr UINT InitFailed = WM_APP + 1;
constexpr int WindowWidth = 1200;
constexpr int WindowHeight = 820;
constexpr DWORD ReadBlock = 64 * 1024;

struct WindowState {
    HWND window = nullptr;
    ComPtr<ICoreWebView2Environment> environment;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> webView;
    std::filesystem::path assets;
    std::wstring canonicalAssets;
    bool readerHandoffWindow = false;
};

std::vector<std::shared_ptr<WindowState>> windows;

std::wstring modulePath() {
    std::vector<wchar_t> buffer(512);
    for (;;) {
        const DWORD count = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        if (!count) throw std::runtime_error("GetModuleFileNameW failed");
        if (count < buffer.size()) return { buffer.data(), count };
        if (buffer.size() >= 32768) throw std::runtime_error("Executable path is too long");
        buffer.resize(buffer.size() * 2);
    }
}

std::wstring fullPath(const std::wstring& path) {
    std::vector<wchar_t> buffer(512);
    for (;;) {
        const DWORD count = GetFullPathNameW(path.c_str(), static_cast<DWORD>(buffer.size()), buffer.data(), nullptr);
        if (!count) throw std::runtime_error("GetFullPathNameW failed");
        if (count < buffer.size()) return { buffer.data(), count };
        if (count >= 32768) throw std::runtime_error("Resolved path is too long");
        buffer.resize(static_cast<size_t>(count) + 1);
    }
}

std::wstring finalPath(HANDLE file) {
    std::vector<wchar_t> buffer(512);
    for (;;) {
        const DWORD count = GetFinalPathNameByHandleW(file, buffer.data(), static_cast<DWORD>(buffer.size()), FILE_NAME_NORMALIZED);
        if (!count) throw std::runtime_error("GetFinalPathNameByHandleW failed");
        if (count < buffer.size()) {
            std::wstring result(buffer.data(), count);
            if (result.compare(0, 8, L"\\\\?\\UNC\\") == 0) result = L"\\\\" + result.substr(8);
            else if (result.compare(0, 4, L"\\\\?\\") == 0) result.erase(0, 4);
            while (result.size() > 3 && result.back() == L'\\') result.pop_back();
            return result;
        }
        if (count >= 32768) throw std::runtime_error("Resolved path is too long");
        buffer.resize(static_cast<size_t>(count) + 1);
    }
}

bool samePrefix(std::wstring_view value, std::wstring_view prefix) {
    return value.size() >= prefix.size()
        && CompareStringOrdinal(value.data(), static_cast<int>(prefix.size()), prefix.data(),
                                static_cast<int>(prefix.size()), TRUE) == CSTR_EQUAL;
}

bool insideRoot(std::wstring_view root, std::wstring_view path) {
    return path.size() > root.size()
        && samePrefix(path, root)
        && path[root.size()] == L'\\';
}

bool urlAuthority(std::wstring_view url, std::wstring& authority, size_t& suffix) {
    const auto scheme = url.find(L"://");
    if (scheme == std::wstring_view::npos || !samePrefix(url, L"https"sv) || scheme != 5) return false;
    const size_t start = scheme + 3;
    suffix = url.find_first_of(L"/?#", start);
    if (suffix == std::wstring_view::npos) suffix = url.size();
    if (suffix == start) return false;
    authority.assign(url.substr(start, suffix - start));
    if (authority.find_first_of(L"@:\\\\ \t\r\n%") != std::wstring::npos) return false;
    return true;
}

bool isLocalUrl(std::wstring_view url) {
    std::wstring authority;
    size_t suffix = 0;
    if (!urlAuthority(url, authority, suffix)) return false;
    return CompareStringOrdinal(authority.c_str(), -1, prototype_config::Host, -1, TRUE) == CSTR_EQUAL;
}

bool isApprovedReaderUrl(std::wstring_view url) {
    std::wstring authority;
    size_t suffix = 0;
    if (!urlAuthority(url, authority, suffix)) return false;
    return CompareStringOrdinal(authority.c_str(), -1, L"marvel.com", -1, TRUE) == CSTR_EQUAL
        || CompareStringOrdinal(authority.c_str(), -1, L"www.marvel.com", -1, TRUE) == CSTR_EQUAL
        || CompareStringOrdinal(authority.c_str(), -1, L"read.marvel.com", -1, TRUE) == CSTR_EQUAL;
}

bool assetRelativePath(std::wstring_view url, std::wstring& relative) {
    std::wstring authority;
    size_t suffix = 0;
    if (!urlAuthority(url, authority, suffix)
        || CompareStringOrdinal(authority.c_str(), -1, prototype_config::Host, -1, TRUE) != CSTR_EQUAL)
        return false;

    size_t pathStart = suffix;
    if (pathStart == url.size() || url[pathStart] == L'?' || url[pathStart] == L'#') {
        relative = L"index.html";
        return true;
    }
    size_t pathEnd = url.find_first_of(L"?#", pathStart);
    if (pathEnd == std::wstring_view::npos) pathEnd = url.size();
    auto path = url.substr(pathStart, pathEnd - pathStart);
    if (path.empty() || path.front() != L'/' || path.find_first_of(L"%\\:\0") != std::wstring_view::npos)
        return false;

    relative.clear();
    size_t start = 1;
    while (start <= path.size()) {
        const size_t end = path.find(L'/', start);
        const auto segment = path.substr(start, end == std::wstring_view::npos ? path.size() - start : end - start);
        if (segment == L"." || segment == L"..") return false;
        for (const wchar_t character : segment) {
            if (character == L'\0' || character == L'\r' || character == L'\n' || character == L'\t')
                return false;
        }
        if (!segment.empty()) {
            if (!relative.empty()) relative.push_back(L'\\');
            relative.append(segment);
        }
        if (end == std::wstring_view::npos) break;
        start = end + 1;
    }
    if (relative.empty() || path.back() == L'/') {
        if (!relative.empty()) relative.push_back(L'\\');
        relative += L"index.html";
    }
    return true;
}

struct FileData {
    std::vector<unsigned char> bytes;
    std::wstring contentType;
    int status = 200;
    std::wstring reason = L"OK";
};

std::wstring contentTypeFor(const std::wstring& path) {
    const auto dot = path.find_last_of(L'.');
    const auto ext = dot == std::wstring::npos ? L"" : path.substr(dot);
    if (ext == L".html") return L"text/html; charset=utf-8";
    if (ext == L".js" || ext == L".mjs") return L"text/javascript; charset=utf-8";
    if (ext == L".css") return L"text/css; charset=utf-8";
    if (ext == L".json" || ext == L".webmanifest") return L"application/json; charset=utf-8";
    if (ext == L".svg") return L"image/svg+xml";
    if (ext == L".png") return L"image/png";
    if (ext == L".ico") return L"image/x-icon";
    if (ext == L".woff2") return L"font/woff2";
    if (ext == L".txt") return L"text/plain; charset=utf-8";
    return L"application/octet-stream";
}

FileData readAsset(WindowState& state, std::wstring_view uri) {
    std::wstring relative;
    if (!assetRelativePath(uri, relative)) return { {}, L"text/plain; charset=utf-8", 403, L"Forbidden" };

    const auto candidate = fullPath((state.assets / relative).wstring());
    const auto expectedPrefix = state.canonicalAssets + L"\\";
    if (!samePrefix(candidate, expectedPrefix) || candidate.size() <= expectedPrefix.size())
        return { {}, L"text/plain; charset=utf-8", 403, L"Forbidden" };

    HANDLE raw = CreateFileW(candidate.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                             FILE_ATTRIBUTE_NORMAL | FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
    if (raw == INVALID_HANDLE_VALUE) return { {}, L"text/plain; charset=utf-8", 404, L"Not Found" };
    struct Close { HANDLE handle; ~Close() { CloseHandle(handle); } } close{ raw };
    BY_HANDLE_FILE_INFORMATION info{};
    LARGE_INTEGER size{};
    if (!GetFileInformationByHandle(raw, &info) || (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)
        || (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)
        || !GetFileSizeEx(raw, &size) || size.QuadPart < 0
        || static_cast<unsigned long long>(size.QuadPart) > prototype_config::MaximumAssetBytes)
        return { {}, L"text/plain; charset=utf-8", 403, L"Forbidden" };

    const auto actual = finalPath(raw);
    if (!insideRoot(state.canonicalAssets, actual))
        return { {}, L"text/plain; charset=utf-8", 403, L"Forbidden" };

    FileData result;
    result.contentType = contentTypeFor(relative);
    result.bytes.resize(static_cast<size_t>(size.QuadPart));
    size_t offset = 0;
    while (offset < result.bytes.size()) {
        const DWORD requested = static_cast<DWORD>(std::min<size_t>(ReadBlock, result.bytes.size() - offset));
        DWORD count = 0;
        if (!ReadFile(raw, result.bytes.data() + offset, requested, &count, nullptr) || !count)
            return { {}, L"text/plain; charset=utf-8", 500, L"Read Error" };
        offset += count;
    }
    return result;
}

std::wstring headers(const FileData& file) {
    return L"Content-Type: " + file.contentType + L"\r\n"
        + L"Content-Length: " + std::to_wstring(file.bytes.size()) + L"\r\n"
        + L"Content-Security-Policy: " + prototype_config::ContentSecurityPolicy + L"\r\n"
        + L"X-Content-Type-Options: " + prototype_config::XContentTypeOptions + L"\r\n"
        + L"Referrer-Policy: " + prototype_config::ReferrerPolicy + L"\r\n"
        + L"Permissions-Policy: " + prototype_config::PermissionsPolicy + L"\r\n"
        + L"Cache-Control: " + prototype_config::CacheControl + L"\r\n";
}

ComPtr<IStream> streamFor(const std::vector<unsigned char>& bytes) {
    ComPtr<IStream> stream;
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes.empty() ? 1 : bytes.size());
    if (!memory) throw std::bad_alloc();
    void* target = GlobalLock(memory);
    if (!target) { GlobalFree(memory); throw std::bad_alloc(); }
    if (!bytes.empty()) CopyMemory(target, bytes.data(), bytes.size());
    GlobalUnlock(memory);
    const HRESULT result = CreateStreamOnHGlobal(memory, TRUE, &stream);
    if (FAILED(result)) { GlobalFree(memory); throw std::runtime_error("CreateStreamOnHGlobal failed"); }
    return stream;
}

void showError(HWND owner, const std::wstring& text) {
    MessageBoxW(owner, text.c_str(), L"Recap Page WebView2 prototype", MB_OK | MB_ICONERROR);
}

void resizeController(WindowState& state) {
    if (!state.controller || !state.window) return;
    RECT bounds{};
    GetClientRect(state.window, &bounds);
    state.controller->put_Bounds(bounds);
}

std::wstring localUserData() {
    DWORD size = GetEnvironmentVariableW(L"LOCALAPPDATA", nullptr, 0);
    if (!size) throw std::runtime_error("LOCALAPPDATA is not available");
    std::vector<wchar_t> value(size);
    size = GetEnvironmentVariableW(L"LOCALAPPDATA", value.data(), size);
    if (!size || size >= value.size()) throw std::runtime_error("LOCALAPPDATA could not be read");
    return (std::filesystem::path(value.data()) / prototype_config::UserDataDirectory).wstring();
}

std::shared_ptr<WindowState> createWindow(const std::shared_ptr<WindowState>& state);
void initializeWebView(const std::shared_ptr<WindowState>& state);

void openExternal(const std::shared_ptr<WindowState>& state, const std::wstring& uri) {
    if (!isApprovedReaderUrl(uri)) {
        showError(state->window, L"Navigation was blocked because it is not an approved HTTPS Marvel destination.");
        return;
    }
    const auto result = reinterpret_cast<INT_PTR>(ShellExecuteW(state->window, L"open", uri.c_str(), nullptr, nullptr, SW_SHOWNORMAL));
    if (result <= 32) {
        showError(state->window, L"Windows could not open the official Marvel destination in the default browser.");
        return;
    }
    if (state->readerHandoffWindow) PostMessageW(state->window, WM_CLOSE, 0, 0);
}

HRESULT installHandlers(const std::shared_ptr<WindowState>& state) {
    auto core = state->webView;
    ComPtr<ICoreWebView2_4> webView4;
    if (FAILED(core.As(&webView4))) return E_NOINTERFACE;
    EventRegistrationToken token{};
    HRESULT result = core->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [state](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                LPWSTR raw = nullptr;
                if (FAILED(args->get_Uri(&raw)) || !raw) {
                    args->put_Cancel(TRUE);
                    return S_OK;
                }
                std::wstring uri(raw);
                CoTaskMemFree(raw);
                if (isLocalUrl(uri)) return S_OK;
                args->put_Cancel(TRUE);
                openExternal(state, uri);
                return S_OK;
            }).Get(), &token);
    if (FAILED(result)) return result;

    result = core->add_WebResourceRequested(
        Callback<ICoreWebView2WebResourceRequestedEventHandler>(
            [state](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
                ComPtr<ICoreWebView2WebResourceRequest> request;
                if (FAILED(args->get_Request(&request)) || !request) return E_FAIL;
                LPWSTR raw = nullptr;
                if (FAILED(request->get_Uri(&raw)) || !raw) return E_FAIL;
                std::wstring uri(raw);
                CoTaskMemFree(raw);
                FileData file;
                try { file = readAsset(*state, uri); }
                catch (...) { file = { {}, L"text/plain; charset=utf-8", 500, L"Read Error" }; }
                ComPtr<IStream> stream;
                try { stream = streamFor(file.bytes); }
                catch (...) { return E_OUTOFMEMORY; }
                ComPtr<ICoreWebView2WebResourceResponse> response;
                const auto responseHeaders = headers(file);
                const HRESULT created = state->environment->CreateWebResourceResponse(
                    stream.Get(), file.status, file.reason.c_str(), responseHeaders.c_str(), &response);
                if (FAILED(created)) return created;
                return args->put_Response(response.Get());
            }).Get(), &token);
    if (FAILED(result)) return result;

    result = core->AddWebResourceRequestedFilter(
        (std::wstring(prototype_config::Origin) + L"/*").c_str(),
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
    if (FAILED(result)) return result;

    result = core->add_NewWindowRequested(
        Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [state](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                LPWSTR raw = nullptr;
                if (FAILED(args->get_Uri(&raw)) || !raw) {
                    args->put_Handled(TRUE);
                    showError(state->window, L"The new window request did not contain a URL.");
                    return S_OK;
                }
                std::wstring uri(raw);
                CoTaskMemFree(raw);
                if (!isLocalUrl(uri)) {
                    args->put_Handled(TRUE);
                    openExternal(state, uri);
                    return S_OK;
                }
                ComPtr<ICoreWebView2Deferral> deferral;
                if (FAILED(args->GetDeferral(&deferral))) {
                    args->put_Handled(TRUE);
                    showError(state->window, L"The reader launch window could not be prepared.");
                    return S_OK;
                }
                auto child = std::make_shared<WindowState>();
                child->environment = state->environment;
                child->assets = state->assets;
                child->canonicalAssets = state->canonicalAssets;
                child->readerHandoffWindow = true;
                child = createWindow(child);
                if (!child) {
                    args->put_Handled(TRUE);
                    deferral->Complete();
                    showError(state->window, L"The reader launch window could not be created.");
                    return S_OK;
                }
                state->environment->CreateCoreWebView2Controller(
                    child->window,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [child, args, deferral](HRESULT hr, ICoreWebView2Controller* controller) -> HRESULT {
                            if (SUCCEEDED(hr) && controller) {
                                child->controller = controller;
                                child->controller->get_CoreWebView2(&child->webView);
                                resizeController(*child);
                                const HRESULT hooked = installHandlers(child);
                                if (SUCCEEDED(hooked)) {
                                    args->put_NewWindow(child->webView.Get());
                                    args->put_Handled(TRUE);
                                    ShowWindow(child->window, SW_SHOWNORMAL);
                                    UpdateWindow(child->window);
                                } else {
                                    args->put_Handled(TRUE);
                                    showError(child->window, L"The reader launch window security handlers failed to initialize.");
                                    PostMessageW(child->window, WM_CLOSE, 0, 0);
                                }
                            } else {
                                args->put_Handled(TRUE);
                                showError(child->window, L"WebView2 could not create the reader launch window.");
                                PostMessageW(child->window, WM_CLOSE, 0, 0);
                            }
                            deferral->Complete();
                            return S_OK;
                        }).Get());
                return S_OK;
            }).Get(), &token);
    if (FAILED(result)) return result;

    return webView4->add_DownloadStarting(
        Callback<ICoreWebView2DownloadStartingEventHandler>(
            [state](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* args) -> HRESULT {
                ComPtr<ICoreWebView2DownloadOperation> operation;
                if (FAILED(args->get_DownloadOperation(&operation)) || !operation) return E_FAIL;
                LPWSTR suggested = nullptr;
                operation->get_ResultFilePath(&suggested);
                ComPtr<IFileSaveDialog> dialog;
                HRESULT hr = CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER,
                                               IID_PPV_ARGS(&dialog));
                if (SUCCEEDED(hr)) {
                    DWORD options = 0;
                    hr = dialog->GetOptions(&options);
                    if (SUCCEEDED(hr)) hr = dialog->SetOptions(options | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_OVERWRITEPROMPT);
                    if (SUCCEEDED(hr) && suggested) {
                        const wchar_t* base = PathFindFileNameW(suggested);
                        if (base && *base) hr = dialog->SetFileName(base);
                    }
                    if (SUCCEEDED(hr)) hr = dialog->Show(state->window);
                }
                if (suggested) CoTaskMemFree(suggested);
                args->put_Handled(TRUE);
                if (hr == HRESULT_FROM_WIN32(ERROR_CANCELLED)) {
                    args->put_Cancel(TRUE);
                    return S_OK;
                }
                if (FAILED(hr)) {
                    args->put_Cancel(TRUE);
                    showError(state->window, L"The native save dialog could not be opened. The download was cancelled.");
                    return S_OK;
                }
                ComPtr<IShellItem> item;
                hr = dialog->GetResult(&item);
                PWSTR path = nullptr;
                if (SUCCEEDED(hr)) hr = item->GetDisplayName(SIGDN_FILESYSPATH, &path);
                if (SUCCEEDED(hr) && path) hr = args->put_ResultFilePath(path);
                if (path) CoTaskMemFree(path);
                if (FAILED(hr)) {
                    args->put_Cancel(TRUE);
                    showError(state->window, L"The download destination could not be selected. No file was saved.");
                } else {
                    args->put_Cancel(FALSE);
                }
                return S_OK;
            }).Get(), &token);
}

void initializeController(const std::shared_ptr<WindowState>& state, ICoreWebView2Controller* controller) {
    state->controller = controller;
    if (FAILED(controller->get_CoreWebView2(&state->webView)) || !state->webView) {
        showError(state->window, L"WebView2 did not provide a browser surface.");
        return;
    }
    ComPtr<ICoreWebView2_3> webView3;
    if (FAILED(state->webView.As(&webView3))) {
        showError(state->window, L"This WebView2 runtime does not support virtual host mapping.");
        return;
    }
    const HRESULT mapped = webView3->SetVirtualHostNameToFolderMapping(
        prototype_config::Host, state->assets.c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
    if (FAILED(mapped)) {
        showError(state->window, L"Local app content could not be mapped to its isolated virtual origin.");
        return;
    }
    ComPtr<ICoreWebView2Settings> settings;
    if (SUCCEEDED(state->webView->get_Settings(&settings)) && settings) {
        settings->put_AreDevToolsEnabled(FALSE);
        settings->put_AreDefaultContextMenusEnabled(TRUE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_IsZoomControlEnabled(TRUE);
    }
    resizeController(*state);
    const HRESULT hooked = installHandlers(state);
    if (FAILED(hooked)) {
        showError(state->window, L"Local content and navigation security handlers could not be installed.");
        return;
    }
    if (FAILED(state->webView->Navigate((std::wstring(prototype_config::Origin) + L"/index.html").c_str()))) {
        showError(state->window, L"The local application page could not be opened.");
    }
}

void initializeWebView(const std::shared_ptr<WindowState>& state) {
    try {
        std::filesystem::create_directories(localUserData());
    } catch (...) {
        showError(state->window, L"An isolated WebView2 user-data directory could not be created.");
        return;
    }
    const std::wstring userData = localUserData();
    const HRESULT created = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, userData.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [state](HRESULT hr, ICoreWebView2Environment* environment) -> HRESULT {
                if (FAILED(hr) || !environment) {
                    showError(state->window,
                        L"WebView2 Runtime is unavailable. Install the Microsoft Edge WebView2 Runtime using the official Microsoft installer, then reopen this prototype. No installer was started.");
                    return S_OK;
                }
                state->environment = environment;
                state->environment->CreateCoreWebView2Controller(
                    state->window,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [state](HRESULT controllerResult, ICoreWebView2Controller* controller) -> HRESULT {
                            if (FAILED(controllerResult) || !controller) {
                                showError(state->window, L"WebView2 could not create a native controller.");
                                return S_OK;
                            }
                            initializeController(state, controller);
                            return S_OK;
                        }).Get());
                return S_OK;
            }).Get());
    if (FAILED(created)) {
        showError(state->window,
            L"WebView2 Runtime could not start. Verify that the installed runtime is supported and reopen the prototype.");
    }
}

std::shared_ptr<WindowState> createWindow(const std::shared_ptr<WindowState>& state) {
    state->window = CreateWindowExW(
        0, WindowClass, L"Recap Page WebView2 prototype",
        WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, WindowWidth, WindowHeight,
        nullptr, nullptr, GetModuleHandleW(nullptr), state.get());
    if (!state->window) return {};
    windows.push_back(state);
    return state;
}

LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    auto* state = reinterpret_cast<WindowState*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    if (message == WM_NCCREATE) {
        const auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
        state = static_cast<WindowState*>(create->lpCreateParams);
        state->window = window;
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(state));
    }
    switch (message) {
    case WM_SIZE:
        if (state) resizeController(*state);
        return 0;
    case WM_CLOSE:
        if (state && state->controller) state->controller->Close();
        DestroyWindow(window);
        return 0;
    case WM_NCDESTROY:
        if (state) {
            state->window = nullptr;
            windows.erase(std::remove_if(windows.begin(), windows.end(),
                [state](const auto& item) { return item.get() == state; }), windows.end());
        }
        SetWindowLongPtrW(window, GWLP_USERDATA, 0);
        if (windows.empty()) PostQuitMessage(0);
        return DefWindowProcW(window, message, wParam, lParam);
    default:
        return DefWindowProcW(window, message, wParam, lParam);
    }
}

std::filesystem::path assetRoot() {
    const std::filesystem::path executable(modulePath());
    return std::filesystem::path(fullPath(executable.parent_path().wstring())) / L"assets";
}

std::wstring canonicalDirectory(const std::filesystem::path& directory) {
    HANDLE raw = CreateFileW(directory.c_str(), FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    if (raw == INVALID_HANDLE_VALUE) throw std::runtime_error("Asset root is unavailable");
    struct Close { HANDLE handle; ~Close() { CloseHandle(handle); } } close{ raw };
    BY_HANDLE_FILE_INFORMATION info{};
    if (!GetFileInformationByHandle(raw, &info) || !(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY))
        throw std::runtime_error("Asset root is not a directory");
    return finalPath(raw);
}

int run(HINSTANCE instance) {
    const HRESULT com = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(com)) throw std::runtime_error("COM initialization failed");
    struct CoUninit { ~CoUninit() { CoUninitialize(); } } uninit;

    WNDCLASSEXW type{};
    type.cbSize = sizeof(type);
    type.lpfnWndProc = windowProc;
    type.hInstance = instance;
    type.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    type.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
    type.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    type.lpszClassName = WindowClass;
    if (!RegisterClassExW(&type) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS)
        throw std::runtime_error("Window class registration failed");

    auto state = std::make_shared<WindowState>();
    state->assets = assetRoot();
    state->canonicalAssets = canonicalDirectory(state->assets);
    auto primary = createWindow(state);
    if (!primary) throw std::runtime_error("Native window creation failed");
    ShowWindow(primary->window, SW_SHOWNORMAL);
    UpdateWindow(primary->window);
    initializeWebView(primary);

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    return static_cast<int>(message.wParam);
}
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    try {
        return run(instance);
    } catch (...) {
        MessageBoxW(nullptr, L"The WebView2 prototype could not start. Review its local build prerequisites.",
                    L"Recap Page WebView2 prototype", MB_OK | MB_ICONERROR);
        return 1;
    }
}
