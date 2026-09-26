package io.github.raymondnassar.recappage.prototype;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Loopback-only fabricated metadata; no proxying or remote requests. */
final class FixtureMetadataServer implements AutoCloseable {
    private final ServerSocket listener;
    private final ExecutorService clients = Executors.newCachedThreadPool();
    private final Thread acceptor;
    final CountDownLatch lookupStarted = new CountDownLatch(1);
    final CountDownLatch releaseLookup = new CountDownLatch(1);
    final AtomicInteger issueRequests = new AtomicInteger();
    volatile IOException failure;
    private volatile boolean closed;

    FixtureMetadataServer() throws IOException {
        listener = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
        acceptor = new Thread(() -> {
            while (!closed) {
                try {
                    Socket socket = listener.accept();
                    clients.execute(() -> serve(socket));
                } catch (IOException error) {
                    if (!closed) failure = error;
                }
            }
        }, "native-fixture-http");
        acceptor.start();
    }

    String baseUrl() {
        return "http://127.0.0.1:" + listener.getLocalPort() + "/v1";
    }

    private void serve(Socket socket) {
        try (socket) {
            socket.setSoTimeout(4000);
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
            String request = reader.readLine();
            if (request == null) return;
            String[] parts = request.split(" ");
            if (parts.length < 2) throw new IOException("Malformed fixture request");
            for (String line; (line = reader.readLine()) != null && !line.isEmpty();) {
                // Consume headers without recording anything sent by the WebView.
            }
            String path = parts[1].split("\\?", 2)[0];
            boolean issue = path.equals("/v1/issues/900000002");
            String body;
            String status = "200 OK";
            if (issue) {
                issueRequests.incrementAndGet();
                lookupStarted.countDown();
                if (!releaseLookup.await(7, TimeUnit.SECONDS)) {
                    throw new IOException("Popup observation did not release its synthetic lookup");
                }
                body = "{\"id\":900000002,\"digitalId\":900000099,\"title\":\"Native fixture #2\"}";
            } else if (path.equals("/v1/health")) {
                body = "{\"status\":\"ok\",\"issue_count\":2}";
            } else {
                status = "404 Not Found";
                body = "{\"error\":\"Only synthetic fixture routes exist\"}";
            }
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            String headers = "HTTP/1.1 " + status + "\r\n"
                    + "Content-Type: application/json; charset=utf-8\r\n"
                    + "Access-Control-Allow-Origin: http://127.0.0.1:8787\r\n"
                    + "Cache-Control: no-store\r\nConnection: close\r\n"
                    + "Content-Length: " + bytes.length + "\r\n\r\n";
            socket.getOutputStream().write(headers.getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().write(bytes);
            socket.getOutputStream().flush();
        } catch (IOException error) {
            if (!closed) failure = error;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        }
    }

    @Override
    public void close() throws IOException {
        closed = true;
        releaseLookup.countDown();
        listener.close();
        clients.shutdownNow();
        try {
            acceptor.join(2000);
            clients.awaitTermination(2, TimeUnit.SECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
        }
    }
}
