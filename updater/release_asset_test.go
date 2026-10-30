package main

import "testing"

func TestReleaseAssetsAllowOnlyRepositoryCapitalizationChanges(t *testing.T) {
	expected := "https://github.com/n1k0m0/minimail/releases/download/v0.1.0-rc.17/release.json"
	for _, actual := range []string{expected, "https://github.com/n1k0m0/MiniMail/releases/download/v0.1.0-rc.17/release.json", "https://github.com/N1K0M0/MINIMAIL/releases/download/v0.1.0-rc.17/release.json"} {
		if !matchingReleaseAsset(actual, expected) {
			t.Fatalf("repository capitalization rejected: %s", actual)
		}
	}
	for _, actual := range []string{
		"http://github.com/n1k0m0/MiniMail/releases/download/v0.1.0-rc.17/release.json",
		"https://github.com.evil.example/n1k0m0/MiniMail/releases/download/v0.1.0-rc.17/release.json",
		"https://elsewhere.example/n1k0m0/MiniMail/releases/download/v0.1.0-rc.17/release.json",
		"https://user@github.com/n1k0m0/MiniMail/releases/download/v0.1.0-rc.17/release.json",
		"https://github.com/other/MiniMail/releases/download/v0.1.0-rc.17/release.json",
		"https://github.com/n1k0m0/other/releases/download/v0.1.0-rc.17/release.json",
		"https://github.com/n1k0m0/MiniMail/releases/download/v0.1.0-rc.17/Release.json",
		"https://github.com/n1k0m0/MiniMail/releases/download/v0.1.0-RC.17/release.json",
		expected + "?download=1", expected + "?", expected + "#fragment",
		"https://github.com/n1k0m0/MiniMail/releases/download/v0.1.0-rc.17/%72elease.json",
	} {
		if matchingReleaseAsset(actual, expected) {
			t.Fatalf("untrusted or changed asset path accepted: %s", actual)
		}
	}
}
