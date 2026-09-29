# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

<a id="run-from-source"></a>

### Run the FerrPOINT fork from source

Install Git, Node.js 22.19.x or 24+ with `npm`, and `pnpm` 11.7.0. This route builds the FerrPOINT fork locally and does not use Docker.

```sh
npm install --global pnpm@11.7.0
git clone --branch dsh/customizations/dsh-v0.2.0-rc.1 https://github.com/FerrPOINT/deepseek-harness.git
cd deepseek-harness
pnpm install --frozen-lockfile
pnpm run build
pnpm dsh web
```

The first Web profile uses OpenRouter with DeepSeek V4.1 Flash, a 256K context, and the Russian interface. Set `OPENROUTER_API_KEY` before launch or add the key in DSH credentials; the repository does not include credentials. Existing profiles retain their own settings. The profile grants full access without approval prompts, within the current OS account; review the [safety notice](SAFETY.md) before running untrusted projects.

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. Pass `--no-open` to run the server without opening a browser. See the [Web UI guide](docs/user/guide/index.md).

### Run the official npm release (not this fork)

This command installs the official published release and does not include FerrPOINT fork changes:

```sh
npx @deepseek-ai/dsh web
```

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
