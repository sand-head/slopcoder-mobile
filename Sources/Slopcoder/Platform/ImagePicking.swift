#if canImport(UIKit)
import PhotosUI
import SlopcoderCore
import SwiftUI
import UIKit

/// Turning a chosen photo into something a prompt can carry.
///
/// Scaled so its longest edge is at most `ImageRules.maxEdge` and re-encoded as
/// JPEG — a phone photo is ten megabytes and the limit is two — then checked
/// against the same rules the server applies, so a refusal is said beside the
/// composer rather than discovered as a rejected turn.
/// Why an image was not attached, in words for the person.
struct ImageRefusal: Error {
    let message: String
}

enum ImageEncoding {
    static func pending(from image: UIImage, name: String? = nil) -> Result<PendingImage, ImageRefusal> {
        let scaled = downscale(image)
        guard let data = scaled.jpegData(compressionQuality: 0.8) else {
            return .failure(ImageRefusal(message: "\(name ?? "That image") could not be read."))
        }
        let base64 = data.base64EncodedString()
        if let problem = ImageRules.problem(name: name, mediaType: "image/jpeg", base64: base64) {
            return .failure(ImageRefusal(message: problem))
        }
        return .success(PendingImage(key: UUID().uuidString, mediaType: "image/jpeg", base64Data: base64))
    }

    private static func downscale(_ image: UIImage) -> UIImage {
        let longest = max(image.size.width, image.size.height) * image.scale
        let limit = CGFloat(ImageRules.maxEdge)
        guard longest > limit else { return image }
        let ratio = limit / longest
        let size = CGSize(width: image.size.width * image.scale * ratio, height: image.size.height * image.scale * ratio)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    /// The picker's choices, loaded and encoded, with the first reason any was refused.
    static func load(_ items: [PhotosPickerItem], room: Int) async -> (images: [PendingImage], error: String?) {
        var images: [PendingImage] = []
        var error: String?
        for item in items {
            if images.count >= room {
                error = ImageRules.tooMany
                break
            }
            guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
                error = "That image could not be read."
                continue
            }
            switch pending(from: image) {
            case .success(let pending): images.append(pending)
            case .failure(let reason): error = reason.message
            }
        }
        return (images, error)
    }

    static func image(_ pending: PendingImage) -> UIImage? {
        Data(base64Encoded: pending.base64Data).flatMap(UIImage.init(data:))
    }
}

/// The system camera, for one photo.
struct CameraPicker: UIViewControllerRepresentable {
    let onImage: (UIImage?) -> Void

    static var available: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    func makeCoordinator() -> Coordinator { Coordinator(onImage: onImage) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraDevice = .rear
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onImage: (UIImage?) -> Void

        init(onImage: @escaping (UIImage?) -> Void) { self.onImage = onImage }

        func imagePickerController(
            _ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            onImage(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onImage(nil)
        }
    }
}
#endif
