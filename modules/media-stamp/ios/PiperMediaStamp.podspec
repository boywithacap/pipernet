Pod::Spec.new do |s|
  s.name = 'PiperMediaStamp'
  s.version = '1.0.0'
  s.summary = 'Visible capture timestamps for PiperNet photos and videos'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'PiperNet'
  s.homepage = 'https://expo.dev'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.swift_version = '5.9'
  s.frameworks = 'AVFoundation', 'UIKit', 'QuartzCore'
end
