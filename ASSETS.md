# 林间学园美术素材

使用内置 `image_gen` 工具生成；已复制到项目，打包时由 Vite 放入运行资源。植物图形、界面装饰与交互动画由本地 SVG/CSS 实现。参考图用于确定森林、苔藓机械、午后光束与低饱和手绘的方向。

| 素材         | 项目中的最终文件                              | 背景   |
| ------------ | --------------------------------------------- | ------ |
| 森林家园     | `D:/Codex项目/知识库/public/art/garden.png`   | 不透明 |
| 室内书房     | `D:/Codex项目/知识库/public/art/home.png`     | 不透明 |
| 旅人站立角色 | `D:/Codex项目/知识库/public/art/traveler.png` | 透明   |
| 旅人坐下阅读 | `D:/Codex项目/知识库/public/art/seated.png`   | 透明   |

## 森林家园提示词

```text
Use case: stylized-concept. Asset type: production background illustration for a Windows cozy learning game, NO UI, NO lettering, NO watermark. Create one cinematic ultrawide 16:9 hand-painted Japanese fantasy animation cel-shaded forest garden environment, warm peaceful melancholy. Horizontal side-scrolling game viewpoint, visible ground walkway across the lower quarter. A moss-covered enormous abandoned original gentle mechanical ruin in the distant right, botanical garden clearing in the middle with room for movable plants, small warm wooden cottage with glowing windows on the left, tall trees and dangling vines frame scene, soft afternoon shafts of sunlight through a misty forest, muted sage green, warm pale honey light, hand-drawn linework, painted textured foliage, sophisticated layered depth, coherent architectural proportions. No people or plants in foreground planting slots, no game icons. This must be an original scene, wide straight-on composition suitable for a controllable character walking along the ground.
```

## 室内书房提示词

```text
Use case: stylized-concept. Asset type: final game background, original cozy hand-painted cel-shaded fantasy animation, muted sage green and amber, horizontal side-view cinematic 16:9 composition. Interior of a warmly lit wooden forest cottage used as a study, a large bookshelf on the left filled with well-loved books, a substantial wooden study desk and chair at the right with an open book, warm window light rays and hanging plants, old mossy stone traces and tiny antique mechanical details, honey colored afternoon sun and soft dusty air, textured painterly surfaces and careful linework. A walkable unobstructed wooden floor stretches across the lower third for a controllable game character. Straight-on side view, no people, no text, no UI, no watermarks. Dreamlike quiet intimate atmosphere. This is a production illustration not a screenshot or interface.
```

## 站立角色提示词

```text
Use case: stylized-concept. Production game character asset, TRANSPARENT background with genuine alpha. One single full-body small cozy forest traveler, young adult androgynous, wide soft straw hat with muted green ribbon, short olive green cape, cream shirt, brown trousers and boots, tiny satchel. Facing three-quarter to the RIGHT, standing upright, entire body and shoes visible, charming hand-drawn Japanese fantasy animation cel-shaded illustration with softly textured shading, warm low-saturation colors, clean readable silhouette, proportions 3.5 heads tall, friendly calm expression. Centered with small padding. No environment, no shadow rectangle, no typography, no border, no other characters, no ground, no props beyond worn clothing. Intended as a walking avatar in a hand-painted forest learning game.
```

## 坐下阅读编辑提示词

输入为项目中的 `public/art/traveler.png`，保留透明背景。

```text
Edit the supplied traveler asset. Preserve the same character identity, straw hat, olive green cape, cream shirt, brown trousers and boots, and hand-drawn cel-shaded illustration style and colors. Change pose to a FULL BODY seated reading pose: character seated on a simple small wooden chair, facing right in side three-quarter view, holding an open book on their lap, boots resting on floor level. Include the entire wooden chair and all boots. Single character and chair ONLY. Replace any existing background or halo with genuine fully transparent alpha; no ground, no environment, no text, no cast-shadow rectangle. Keep clean edges and small padding. This is the sitting sprite for a cozy shared study room game.
```
