import Foundation

/// Turns an APNs token into a Web Push endpoint, at the relay.
///
/// The relay is not the instance the phone is signed in to. It is whichever
/// slopcoder deployment holds the key Apple issued for this app — the app
/// publisher's — and the app has its address built in (`SlopcoderPushRelay` in
/// Info.plist, from the `SLOPCODER_PUSH_RELAY` build setting). Registration is
/// unauthenticated: the relay has no accounts, only endpoints, and the endpoint
/// it hands back is the secret.
///
/// This is what lets a phone get notifications from an instance whose hoster
/// has nothing from Apple: the instance sends ordinary Web Push to the endpoint,
/// and never learns a phone is involved.
struct PushRelayClient {
    let relay: URL

    /// Nil when the build carries no relay address, in which case nothing can be
    /// subscribed and the app says so once in the log.
    static var configured: PushRelayClient? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "SlopcoderPushRelay") as? String,
              !value.isEmpty,
              let url = URL(string: value.hasSuffix("/") ? value : value + "/"),
              url.scheme == "https" || url.host == "localhost"
        else { return nil }
        return PushRelayClient(relay: url)
    }

    private struct RegisterRequest: Encodable {
        let token: String
        let sandbox: Bool
    }

    private struct RegisterResponse: Decodable {
        let endpoint: String
    }

    /// `POST /relay/register` → the endpoint to subscribe with.
    func register(token: String, sandbox: Bool) async throws -> String {
        var request = URLRequest(url: relay.appendingPathComponent("relay/register"))
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(RegisterRequest(token: token, sandbox: sandbox))

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw PushRelayError.refused((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return try JSONDecoder().decode(RegisterResponse.self, from: data).endpoint
    }
}

enum PushRelayError: Error {
    case refused(Int)
}
