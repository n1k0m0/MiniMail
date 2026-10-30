package main

import (
	"context"
	"crypto/ed25519"
	"crypto/x509"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const repository = "n1k0m0/minimail"

var updaterVersion = "0.1.1"

//go:embed public-key.pem
var trustedKeyPEM []byte

type Manifest struct {
	Format             int               `json:"format"`
	Version            string            `json:"version"`
	Revision           string            `json:"revision"`
	Image              string            `json:"image"`
	DatabaseImage      string            `json:"databaseImage"`
	VPNImage           string            `json:"vpnImage,omitempty"`
	Schema             int               `json:"schema"`
	ReadSchemaMin      int               `json:"readSchemaMin"`
	ReadSchemaMax      int               `json:"readSchemaMax"`
	MinUpdater         string            `json:"minUpdater"`
	AutomaticPatchSafe bool              `json:"automaticPatchSafe"`
	Assets             map[string]string `json:"assets"`
}

var versionPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(rc|beta|alpha)\.([1-9][0-9]*))?$`)

type version struct {
	major, minor, patch int
	pre                 string
	number              int
}

func parseVersion(input string) (version, error) {
	match := versionPattern.FindStringSubmatch(strings.TrimPrefix(input, "v"))
	if match == nil {
		return version{}, fmt.Errorf("invalid release version: %q", input)
	}
	a, e := strconv.Atoi(match[1])
	if e != nil {
		return version{}, e
	}
	b, e := strconv.Atoi(match[2])
	if e != nil {
		return version{}, e
	}
	c, e := strconv.Atoi(match[3])
	if e != nil {
		return version{}, e
	}
	n := 0
	if match[5] != "" {
		n, e = strconv.Atoi(match[5])
		if e != nil {
			return version{}, e
		}
	}
	return version{a, b, c, match[4], n}, nil
}
func compareVersion(a, b string) int {
	x, ex := parseVersion(a)
	y, ey := parseVersion(b)
	if ex != nil || ey != nil {
		return 0
	}
	for _, pair := range [][2]int{{x.major, y.major}, {x.minor, y.minor}, {x.patch, y.patch}} {
		if pair[0] < pair[1] {
			return -1
		}
		if pair[0] > pair[1] {
			return 1
		}
	}
	rank := map[string]int{"alpha": 0, "beta": 1, "rc": 2, "": 3}
	if rank[x.pre] < rank[y.pre] {
		return -1
	}
	if rank[x.pre] > rank[y.pre] {
		return 1
	}
	if x.number < y.number {
		return -1
	}
	if x.number > y.number {
		return 1
	}
	return 0
}
func safeAutomatic(current string, m Manifest) bool {
	a, ea := parseVersion(current)
	b, eb := parseVersion(m.Version)
	return ea == nil && eb == nil && a.pre == "" && b.pre == "" && a.major == b.major && a.minor == b.minor && b.patch > a.patch && m.AutomaticPatchSafe
}

var digestPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
var revisionPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
var assetPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$`)
var checksumPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

func (m Manifest) validate() error {
	if m.Format != 1 || !revisionPattern.MatchString(m.Revision) || m.Schema < 1 || m.ReadSchemaMin < 1 || m.ReadSchemaMin > m.Schema || m.ReadSchemaMax < m.Schema {
		return errors.New("unsupported release manifest or schema range")
	}
	if _, e := parseVersion(m.Version); e != nil {
		return e
	}
	if _, e := parseVersion(m.MinUpdater); e != nil {
		return e
	}
	if compareVersion(updaterVersion, m.MinUpdater) < 0 {
		return errors.New("this release needs a newer updater; no services were changed")
	}
	for _, pair := range [][2]string{{m.Image, "minimail"}, {m.DatabaseImage, "minimail-database"}, {m.VPNImage, "minimail-vpn"}} {
		if pair[0] == "" && pair[1] == "minimail-vpn" {
			continue
		}
		prefix := "ghcr.io/n1k0m0/" + pair[1] + "@"
		if !strings.HasPrefix(pair[0], prefix) || !digestPattern.MatchString(strings.TrimPrefix(pair[0], prefix)) {
			return errors.New("release image is not a pinned MiniMail registry digest")
		}
	}
	for name, digest := range m.Assets {
		if !assetPattern.MatchString(name) || strings.HasSuffix(name, ".") || !checksumPattern.MatchString(digest) {
			return errors.New("invalid release asset checksum")
		}
	}
	return nil
}
func verifyManifest(raw, signature, keyPEM []byte) (Manifest, error) {
	var m Manifest
	block, _ := pem.Decode(keyPEM)
	if block == nil {
		return m, errors.New("invalid embedded release trust root")
	}
	key, e := x509.ParsePKIXPublicKey(block.Bytes)
	if e != nil {
		return m, e
	}
	public, ok := key.(ed25519.PublicKey)
	if !ok {
		return m, errors.New("release key must be Ed25519")
	}
	sig, e := base64.StdEncoding.DecodeString(strings.TrimSpace(string(signature)))
	if e != nil || !ed25519.Verify(public, raw, sig) {
		return m, errors.New("release signature verification failed")
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if e = decoder.Decode(&m); e != nil {
		return m, e
	}
	if e = decoder.Decode(new(any)); e != io.EOF {
		return m, errors.New("trailing release manifest data")
	}
	return m, m.validate()
}

type githubRelease struct {
	Tag        string `json:"tag_name"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	Assets     []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}
type ReleaseSource interface {
	Fetch(context.Context, string, string) (Manifest, error)
}
type GitHubSource struct{ Client *http.Client }

func downloadClient() *http.Client {
	return &http.Client{Timeout: 45 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many release redirects")
		}
		return trustedURL(req.URL)
	}}
}
func trustedURL(u *url.URL) error {
	if u.Scheme != "https" || u.User != nil || (u.Port() != "" && u.Port() != "443") {
		return errors.New("release downloads require HTTPS")
	}
	switch u.Hostname() {
	case "api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com":
		return nil
	}
	return errors.New("unexpected release download host")
}
func (g GitHubSource) get(ctx context.Context, address string, limit int64) ([]byte, error) {
	u, e := url.Parse(address)
	if e != nil {
		return nil, e
	}
	if e = trustedURL(u); e != nil {
		return nil, e
	}
	req, e := http.NewRequestWithContext(ctx, "GET", address, nil)
	if e != nil {
		return nil, e
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "MiniMail-Updater/"+updaterVersion)
	client := g.Client
	if client == nil {
		client = downloadClient()
	}
	response, e := client.Do(req)
	if e != nil {
		return nil, e
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, fmt.Errorf("release service returned HTTP %d", response.StatusCode)
	}
	raw, e := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if e != nil {
		return nil, e
	}
	if int64(len(raw)) > limit {
		return nil, errors.New("release response exceeds limit")
	}
	return raw, nil
}
func (g GitHubSource) Fetch(ctx context.Context, channel, tag string) (Manifest, error) {
	var result Manifest
	address := "https://api.github.com/repos/" + repository + "/releases?per_page=100"
	if tag != "" {
		if _, e := parseVersion(tag); e != nil {
			return result, e
		}
		address = "https://api.github.com/repos/" + repository + "/releases/tags/v" + strings.TrimPrefix(tag, "v")
	}
	raw, e := g.get(ctx, address, 2<<20)
	if e != nil {
		return result, e
	}
	var releases []githubRelease
	if tag != "" {
		var r githubRelease
		if e = json.Unmarshal(raw, &r); e != nil {
			return result, e
		}
		releases = []githubRelease{r}
	} else if e = json.Unmarshal(raw, &releases); e != nil {
		return result, e
	}
	releasesFilter := releases[:0]
	for _, r := range releases {
		v, e := parseVersion(r.Tag)
		if e == nil && !r.Draft && (channel == "preview" || (!r.Prerelease && v.pre == "")) {
			releasesFilter = append(releasesFilter, r)
		}
	}
	releases = releasesFilter
	sort.Slice(releases, func(i, j int) bool { return compareVersion(releases[i].Tag, releases[j].Tag) > 0 })
	if len(releases) == 0 {
		return result, errNoRelease
	}
	r := releases[0]
	base := "https://github.com/" + repository + "/releases/download/" + r.Tag + "/"
	found := map[string]bool{}
	for _, a := range r.Assets {
		if a.URL == base+a.Name {
			found[a.Name] = true
		}
	}
	if !found["release.json"] || !found["release.json.sig"] {
		return result, errors.New("release has no signed deployment manifest")
	}
	raw, e = g.get(ctx, base+"release.json", 64<<10)
	if e != nil {
		return result, e
	}
	signature, e := g.get(ctx, base+"release.json.sig", 256)
	if e != nil {
		return result, e
	}
	result, e = verifyManifest(raw, signature, trustedKeyPEM)
	if e != nil {
		return result, e
	}
	if "v"+result.Version != r.Tag {
		return result, errors.New("release tag and signed version differ")
	}
	return result, nil
}

var errNoRelease = errors.New("no published release is available for this channel")
