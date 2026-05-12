import UIKit
import Capacitor
import WebKit
import AVFoundation

/// Custom Capacitor bridge controller that:
///  1. Configures WKWebView for true fullscreen video + autoplay + AirPlay/PiP.
///  2. Configures AVAudioSession so audio plays even with the silent switch on
///     and ducks correctly with system audio.
///  3. Injects mobile-overrides.css and mobile-overrides.js as WKUserScripts
///     at document-start/end so toustream.xyz renders with native-app styling.
class ViewController: CAPBridgeViewController {

    // MARK: - WebView configuration (BEFORE WKWebView init)

    /// Capacitor calls this to build the WKWebView. We tweak the configuration
    /// before the WKWebView is created — `allowsInlineMediaPlayback` and
    /// `mediaTypesRequiringUserActionForPlayback` are read-only after init.
    override open func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        // Force the native iOS fullscreen player on any <video> play event,
        // including videos inside the player iframes (vidsrc/embed). This gives
        // us the standard iOS video chrome (fullscreen button, AirPlay, scrubber).
        configuration.allowsInlineMediaPlayback = false

        // Don't require a user gesture to start playback — embeds frequently
        // autoplay or chain into playback after our overrides do their thing.
        configuration.mediaTypesRequiringUserActionForPlayback = []

        // Enable Picture-in-Picture and AirPlay from the native player chrome.
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.allowsAirPlayForMediaPlayback = true

        // Make sure JS is enabled in the modern API (iOS 14+).
        if #available(iOS 14.0, *) {
            configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        }

        // Pre-register our CSS+JS injection here so the scripts run on every
        // page load, including in cross-origin iframes (the player embeds).
        installUserScripts(into: configuration.userContentController)

        return super.webView(with: frame, configuration: configuration)
    }

    // MARK: - Post-load setup

    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        configureAudioSession()
        styleViewAndWebView()
        registerAudioInterruptionObservers()
    }

    /// Make audio play through the speaker even when the silent switch is on,
    /// pause cleanly on phone calls, and resume after.
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback,
                                    mode: .moviePlayback,
                                    options: [.allowAirPlay, .allowBluetoothA2DP])
            try session.setActive(true, options: [])
        } catch {
            // Non-fatal — playback will fall back to whatever WKWebView picks.
            NSLog("Toustream: AVAudioSession setup failed: \(error)")
        }
    }

    private func styleViewAndWebView() {
        let bg = UIColor(red: 0x0b/255, green: 0x0d/255, blue: 0x14/255, alpha: 1)
        view.backgroundColor = bg
        if #available(iOS 13.0, *) {
            overrideUserInterfaceStyle = .dark
        }
        guard let webView = self.webView else { return }
        webView.backgroundColor = bg
        webView.isOpaque = false
        webView.scrollView.backgroundColor = bg
        webView.scrollView.bounces = true
        webView.scrollView.alwaysBounceVertical = true
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.scrollView.showsVerticalScrollIndicator = false
        // Identify as a mobile-app build so the site can detect us if it wants to.
        let baseUA = (webView.value(forKey: "userAgent") as? String) ?? ""
        if !baseUA.contains("ToustreamApp") {
            webView.customUserAgent = baseUA + " ToustreamApp/1.0"
        }
    }

    /// Re-activate AVAudioSession when coming back from background / call.
    private func registerAudioInterruptionObservers() {
        let nc = NotificationCenter.default
        nc.addObserver(self,
                       selector: #selector(handleAudioInterruption(_:)),
                       name: AVAudioSession.interruptionNotification,
                       object: AVAudioSession.sharedInstance())
        nc.addObserver(forName: UIApplication.didBecomeActiveNotification,
                       object: nil,
                       queue: .main) { [weak self] _ in
            self?.configureAudioSession()
        }
    }

    @objc private func handleAudioInterruption(_ note: Notification) {
        guard let userInfo = note.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
        if type == .ended { configureAudioSession() }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // MARK: - User script injection

    /// Inject mobile-overrides.css/js into every frame (main + iframes).
    /// Runs at document-start so styles apply before paint, and again at
    /// document-end as a safety net for pages that mutate <head> late.
    private func installUserScripts(into userContent: WKUserContentController) {
        let css = readBundleString("mobile-overrides", ext: "css") ?? ""
        let js  = readBundleString("mobile-overrides", ext: "js")  ?? ""

        if !css.isEmpty {
            // Use a template literal for safe embedding of arbitrary CSS chars.
            let escaped = css
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "`",  with: "\\`")
                .replacingOccurrences(of: "$",  with: "\\$")
            let cssWrap = """
            (function(){
              try {
                var id = 'ts-injected-css';
                if (document.getElementById(id)) return;
                var s = document.createElement('style');
                s.id = id;
                s.appendChild(document.createTextNode(`\(escaped)`));
                (document.head || document.documentElement).appendChild(s);
              } catch (e) {}
            })();
            """
            // forMainFrameOnly: false → also runs in cross-origin player iframes,
            // so the embed page gets styled too.
            userContent.addUserScript(WKUserScript(
                source: cssWrap, injectionTime: .atDocumentStart, forMainFrameOnly: false))
            userContent.addUserScript(WKUserScript(
                source: cssWrap, injectionTime: .atDocumentEnd, forMainFrameOnly: false))
        }

        if !js.isEmpty {
            // The JS layer (top bar, tab bar) only makes sense on the main frame.
            userContent.addUserScript(WKUserScript(
                source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
    }

    private func readBundleString(_ name: String, ext: String) -> String? {
        if let url = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "public") {
            return try? String(contentsOf: url, encoding: .utf8)
        }
        if let url = Bundle.main.url(forResource: name, withExtension: ext) {
            return try? String(contentsOf: url, encoding: .utf8)
        }
        return nil
    }
}
