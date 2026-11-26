#if canImport(UIKit)
import AVFoundation
import SlopcoderCore
import SwiftUI

/// Getting a key onto the device: a password, or a QR code the web settings page
/// draws. Both end at the same place — a `slop_…` key in the keychain.
///
/// The password is never stored. What is stored is the device-scoped key the
/// server mints in exchange for it, which the owner can revoke from
/// `/settings/api-keys` without changing their password.
///
/// The form is one the OS can fill: the content types are what iCloud Keychain
/// keys off, and the return key walks server → username → password → sign in,
/// so a thumb never has to find the next box.
struct LoginScreen: View {
    private enum FocusedField { case server, user, password }

    @Environment(AuthStore.self) private var auth
    @State private var server = "https://"
    @State private var userName = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var scanning = false
    @FocusState private var focus: FocusedField?

    private var ready: Bool {
        !server.trimmingCharacters(in: .whitespaces).isEmpty && !userName.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Brand(height: 28).padding(.bottom, 8)

                Meta("Server")
                AppField(
                    placeholder: "https://slop.example.com", text: $server, contentType: .URL, keyboard: .URL,
                    submitLabel: .next, onSubmit: { focus = .user }
                )
                .focused($focus, equals: .server)

                Meta("Username")
                AppField(placeholder: "you", text: $userName, contentType: .username, submitLabel: .next, onSubmit: { focus = .password })
                    .focused($focus, equals: .user)

                Meta("Password")
                AppField(placeholder: "••••••••", text: $password, secure: true, contentType: .password, submitLabel: .go, onSubmit: submit)
                    .focused($focus, equals: .password)

                if let error { ErrorText(error) }

                AppButton("Sign in", busy: busy, disabled: !ready, fullWidth: true, action: submit).padding(.top, 6)

                HStack(spacing: 12) {
                    Palette.border.frame(height: 1)
                    Meta("or")
                    Palette.border.frame(height: 1)
                }
                .padding(.vertical, 10)

                AppButton("Scan a pairing code", variant: .outline, disabled: busy, fullWidth: true) { scanning = true }

                Hint("Open Settings → API keys in slopcoder on a computer and choose “Show pairing code”. The code works once, for ninety seconds.")
            }
            .padding(20)
            .padding(.top, 48)
        }
        .scrollDismissesKeyboard(.interactively)
        .pageBackground()
        .fullScreenCover(isPresented: $scanning) {
            // The scanner hands the code back, so the redeem — and any error —
            // happen on the page that shows errors.
            ScanScreen { target in
                scanning = false
                redeem(target)
            }
        }
    }

    private func submit() {
        guard ready, !busy else { return }
        busy = true
        error = nil
        Task {
            do {
                try await auth.signInWithPassword(
                    server: server.trimmingCharacters(in: .whitespaces),
                    userName: userName.trimmingCharacters(in: .whitespaces),
                    password: password
                )
                Haptics.success()
            } catch {
                Haptics.error()
                self.error = loginMessage(error)
            }
            busy = false
        }
    }

    private func redeem(_ target: PairingTarget) {
        busy = true
        error = nil
        Task {
            do {
                try await auth.signInWithPairingCode(server: target.server, code: target.code)
                Haptics.success()
            } catch {
                Haptics.error()
                self.error = loginMessage(error)
            }
            busy = false
        }
    }
}

/// The camera, as a full-screen cover with a real bar over it.
struct ScanScreen: View {
    let onScanned: (PairingTarget) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var permission = AVCaptureDevice.authorizationStatus(for: .video)

    var body: some View {
        NavigationStack {
            Group {
                if permission == .authorized {
                    ZStack(alignment: .bottom) {
                        QRScanner(onCode: handle).ignoresSafeArea()
                        Hint("Point the camera at the QR code on the API keys page.")
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.md))
                            .padding(.horizontal, 20)
                            .padding(.bottom, 24)
                    }
                    .background(Color.black)
                } else {
                    VStack(alignment: .leading, spacing: 14) {
                        BodyText("slopcoder needs the camera to scan a pairing code.")
                        if permission == .notDetermined {
                            AppButton("Allow camera") {
                                AVCaptureDevice.requestAccess(for: .video) { _ in
                                    DispatchQueue.main.async { permission = AVCaptureDevice.authorizationStatus(for: .video) }
                                }
                            }
                        } else {
                            Hint("Camera access is off for slopcoder. Turn it on in Settings, or sign in with a password instead.")
                            AppButton("Open Settings", variant: .outline) {
                                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                            }
                        }
                        Spacer()
                    }
                    .padding(20)
                    .pageBackground()
                }
            }
            .navigationTitle("Scan a pairing code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }

    private func handle(_ value: String) -> Bool {
        guard let target = parsePairingUri(value) else { return false }
        onScanned(target)
        return true
    }
}

/// A camera preview that reports QR codes.
///
/// `onCode` answers whether the code was one of ours. The camera reports per
/// frame, and a pairing code is single-use: once one has been taken, the second
/// frame must not spend it a second time.
struct QRScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Bool

    func makeUIViewController(context: Context) -> ScannerController {
        let controller = ScannerController()
        controller.onCode = onCode
        return controller
    }

    func updateUIViewController(_ controller: ScannerController, context: Context) {
        controller.onCode = onCode
    }

    final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
        var onCode: ((String) -> Bool)?
        private let session = AVCaptureSession()
        private var preview: AVCaptureVideoPreviewLayer?
        private var handled = false
        private let queue = DispatchQueue(label: "codes.sand.slopcoder.scanner")

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = .black

            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input)
            else { return }
            session.addInput(input)

            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { return }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            if output.availableMetadataObjectTypes.contains(.qr) { output.metadataObjectTypes = [.qr] }

            let layer = AVCaptureVideoPreviewLayer(session: session)
            layer.videoGravity = .resizeAspectFill
            layer.frame = view.bounds
            view.layer.addSublayer(layer)
            preview = layer
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            preview?.frame = view.bounds
        }

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            // Starting the session blocks, and must not do it on the main thread.
            let session = self.session
            queue.async { if !session.isRunning { session.startRunning() } }
        }

        override func viewDidDisappear(_ animated: Bool) {
            super.viewDidDisappear(animated)
            let session = self.session
            queue.async { if session.isRunning { session.stopRunning() } }
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection
        ) {
            if handled { return }
            for object in metadataObjects {
                guard let code = object as? AVMetadataMachineReadableCodeObject, let value = code.stringValue else { continue }
                if onCode?(value) == true {
                    handled = true
                    return
                }
            }
        }
    }
}
#endif
