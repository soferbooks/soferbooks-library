//
//  yo.swift
//  ReaderApp
//
//  Created by nss on 17/02/2022.
//  Copyright © 2022 Facebook. All rights reserved.
//

import Foundation
import UIKit

@objc(AppIconShortcuts)
class AppIconShortcuts: NSObject, RCTBridgeModule {
  @objc static func moduleName() -> String! {
    return "AppIconShortcuts"
  }

  @objc static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc func setShortcuts(_ items: [[String: Any]]) {
    var shortcutItems: [UIApplicationShortcutItem] = []
    for item in items.prefix(4) {
      guard
        let id = item["id"] as? String,
        let label = item["label"] as? String,
        let url = item["url"] as? String
      else { continue }
      let sublabel = item["sublabel"] as? String
      let subtitle = (sublabel != nil && !sublabel!.isEmpty && sublabel != label) ? sublabel : nil
      let shortcut = UIApplicationShortcutItem(
        type: id,
        localizedTitle: label,
        localizedSubtitle: subtitle,
        icon: UIApplicationShortcutIcon(type: .bookmark),
        userInfo: ["url": url as NSSecureCoding]
      )
      shortcutItems.append(shortcut)
    }
    DispatchQueue.main.async {
      UIApplication.shared.shortcutItems = shortcutItems
    }
  }
}
