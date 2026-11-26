#if canImport(UserNotifications) && canImport(CryptoKit)
import SlopcoderPush
import UserNotifications

/// Opens what the push relay forwarded.
///
/// Apple delivers the relay's envelope: a placeholder alert, `mutable-content`
/// set, and the Web Push ciphertext under `wp`. This runs before anything is
/// shown, decrypts with the keys the app keeps in the shared Keychain item, and
/// rewrites the alert to the message. The `url` goes into `userInfo`, which is
/// where the app's tap handler already looks.
///
/// Anything going wrong — no keys, a locked phone before first unlock, a body
/// that will not open — leaves the placeholder in place. iOS shows *something*
/// either way; the one thing this must never do is take longer than the
/// system's budget, so there is no network and nothing to wait on.
///
/// `@objc(NotificationService)` pins the Objective-C name, because the
/// extension's Info.plist names its principal class and a Swift module prefix
/// would otherwise be part of it.
@objc(NotificationService)
final class NotificationService: UNNotificationServiceExtension {
    private var handler: ((UNNotificationContent) -> Void)?
    private var content: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        handler = contentHandler
        let content = (request.content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
        self.content = content

        if let opened = PushMessage.open(request.content.userInfo) {
            if let title = opened.title, !title.isEmpty { content.title = title }
            if let body = opened.body { content.body = body }
            if let url = opened.url {
                var info = content.userInfo
                info["url"] = url
                content.userInfo = info
            }
        }

        contentHandler(content)
    }

    /// The system is about to give up on us; hand back whatever we have.
    override func serviceExtensionTimeWillExpire() {
        if let handler, let content { handler(content) }
    }
}
#endif
