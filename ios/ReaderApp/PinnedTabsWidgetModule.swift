//  Hands the pinned tabs to the home-screen widget (ios/PinnedTabsWidget) through a keychain item the two
//  share (keychain-access-groups in both entitlements), and asks WidgetKit to redraw it.
//  JS: NativeModules.PinnedTabsWidget.setSnapshot(json) - widgets/pinnedTabsWidget.js

import Foundation
import Security
import WidgetKit

@objc(PinnedTabsWidget)
class PinnedTabsWidgetModule: NSObject {
  static let service = "com.soferbooks.library.pinnedTabsWidget"
  static let account = "snapshot"
  static let accessGroup = "2626EW4BML.com.soferbooks.library.shared"

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc func setSnapshot(_ json: String) {
    guard let data = json.data(using: .utf8) else { return }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.service,
      kSecAttrAccount as String: Self.account,
      kSecAttrAccessGroup as String: Self.accessGroup,
    ]
    SecItemDelete(query as CFDictionary)
    var add = query
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    SecItemAdd(add as CFDictionary, nil)
    WidgetCenter.shared.reloadAllTimelines()
  }
}
