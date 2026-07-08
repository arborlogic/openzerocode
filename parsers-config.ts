// Tree-sitter WASM parser configuration for syntax highlighting.
// Markdown, JavaScript, and TypeScript use opentui's built-in parsers.
// External parsers are loaded as .wasm files from GitHub releases.

export default {
  parsers: [
    {
      filetype: "python",
      wasm: "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
      queries: {
        highlights: [
          "https://github.com/tree-sitter/tree-sitter-python/raw/refs/heads/master/queries/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/python/locals.scm",
        ],
      },
    },
    {
      filetype: "rust",
      wasm: "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.24.0/tree-sitter-rust.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/rust/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/rust/locals.scm",
        ],
      },
    },
    {
      filetype: "go",
      wasm: "https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.25.0/tree-sitter-go.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/go/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/go/locals.scm",
        ],
      },
    },
    {
      filetype: "cpp",
      wasm: "https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.23.4/tree-sitter-cpp.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/cpp/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/cpp/locals.scm",
        ],
      },
    },
    {
      filetype: "csharp",
      wasm: "https://github.com/tree-sitter/tree-sitter-c-sharp/releases/download/v0.23.1/tree-sitter-c_sharp.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c_sharp/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/c_sharp/locals.scm",
        ],
      },
    },
    {
      filetype: "bash",
      wasm: "https://github.com/tree-sitter/tree-sitter-bash/releases/download/v0.25.0/tree-sitter-bash.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/bash/highlights.scm",
        ],
      },
    },
    {
      filetype: "ruby",
      wasm: "https://github.com/tree-sitter/tree-sitter-ruby/releases/download/v0.23.1/tree-sitter-ruby.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/ruby/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/ruby/locals.scm",
        ],
      },
    },
    {
      filetype: "java",
      wasm: "https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.23.5/tree-sitter-java.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/java/highlights.scm",
        ],
        locals: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/java/locals.scm",
        ],
      },
    },
    {
      filetype: "kotlin",
      wasm: "https://github.com/fwcd/tree-sitter-kotlin/releases/download/v0.2.6/tree-sitter-kotlin.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/fwcd/tree-sitter-kotlin/main/queries/highlights.scm",
        ],
      },
    },
    {
      filetype: "html",
      wasm: "https://github.com/tree-sitter/tree-sitter-html/releases/download/v0.23.2/tree-sitter-html.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/html/highlights.scm",
        ],
      },
    },
    {
      filetype: "css",
      wasm: "https://github.com/tree-sitter/tree-sitter-css/releases/download/v0.23.0/tree-sitter-css.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/css/highlights.scm",
        ],
      },
    },
    {
      filetype: "json",
      wasm: "https://github.com/tree-sitter/tree-sitter-json/releases/download/v0.24.0/tree-sitter-json.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/json/highlights.scm",
        ],
      },
    },
    {
      filetype: "yaml",
      wasm: "https://github.com/ikatyang/tree-sitter-yaml/releases/download/v0.7.0/tree-sitter-yaml.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/ikatyang/tree-sitter-yaml/main/queries/highlights.scm",
        ],
      },
    },
    {
      filetype: "lua",
      wasm: "https://github.com/tree-sitter/tree-sitter-lua/releases/download/v0.4.0/tree-sitter-lua.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/lua/highlights.scm",
        ],
      },
    },
    {
      filetype: "haskell",
      wasm: "https://github.com/tree-sitter/tree-sitter-haskell/releases/download/v0.23.0/tree-sitter-haskell.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/haskell/highlights.scm",
        ],
      },
    },
    {
      filetype: "php",
      wasm: "https://github.com/tree-sitter/tree-sitter-php/releases/download/v0.23.5/tree-sitter-php.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/php/highlights.scm",
        ],
      },
    },
    {
      filetype: "scala",
      wasm: "https://github.com/tree-sitter/tree-sitter-scala/releases/download/v0.24.0/tree-sitter-scala.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/scala/highlights.scm",
        ],
      },
    },
    {
      filetype: "toml",
      wasm: "https://github.com/ikatyang/tree-sitter-toml/releases/download/v0.5.11/tree-sitter-toml.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/toml/highlights.scm",
        ],
      },
    },
    {
      filetype: "zig",
      wasm: "https://github.com/tree-sitter/tree-sitter-zig/releases/download/v0.4.0/tree-sitter-zig.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/zig/highlights.scm",
        ],
      },
    },
    {
      filetype: "swift",
      wasm: "https://github.com/tree-sitter/tree-sitter-swift/releases/download/v0.7.0/tree-sitter-swift.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/swift/highlights.scm",
        ],
      },
    },
  ],
}
