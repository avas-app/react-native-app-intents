require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |spec|
  spec.name = "ReactNativeAppIntents"
  spec.version = package["version"]
  spec.summary = package["description"]
  spec.homepage = "https://github.com/avasapp/react-native-app-intents"
  spec.license = package["license"]
  spec.authors = "Copilot"
  spec.platforms = { :ios => "15.1" }
  spec.source = {
    :git => "https://github.com/avasapp/react-native-app-intents.git",
    :tag => "#{spec.version}",
  }

  spec.source_files = "ios/**/*.{h,m,mm}"
  spec.pod_target_xcconfig = { "DEFINES_MODULE" => "YES" }

  spec.dependency "React-Core"
end
