# 第三方组件与许可证

本目录下的文件不是本项目的原创代码，来源与许可证如下。分发或再发布时请一并保留这些文件。

| 文件 | 组件 | 版本 | 许可证 |
|---|---|---|---|
| `tesseract.min.js` | [tesseract.js](https://github.com/naptha/tesseract.js) | 5.1.1 | Apache-2.0，见 `LICENSE-tesseract.js.md` 与 `tesseract.min.js.LICENSE.txt` |
| `worker.min.js` | tesseract.js | 5.1.1 | Apache-2.0，见 `worker.min.js.LICENSE.txt` |
| `tesseract-core-*.wasm(.js)` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 5.1.1 | Apache-2.0，见 `LICENSE-tesseract.js-core.txt` |
| `../tessdata/chi_sim.traineddata.gz` | [tessdata](https://github.com/tesseract-ocr/tessdata) 中文简体模型 | 4.0.0 | Apache-2.0 |

说明：

- 以上组件均以**未修改的原始文件**形式引入，仅做自托管分发，用于在浏览器本地做 OCR。
- 中文语言包 `chi_sim.traineddata.gz` 体积约 20MB，直接以二进制形式提交在仓库中（未使用 Git LFS），
  目的是让站点在离线/内网环境也能完整工作，不依赖任何 CDN。
- 项目自身的代码以仓库根目录的 MIT 许可证发布；上述 vendored 部分仍遵循各自许可证。
