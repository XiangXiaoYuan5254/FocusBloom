# 环境音素材来源

以下录音均来自 [Freesound](https://freesound.org)，授权为 **CC0 1.0（公共领域）**：可以自由复制、修改、分发，包括商用，无需署名。这里仍然列出作者，以示感谢。

| 文件 | 原始录音 | 作者 |
|---|---|---|
| rain.m4a | [Gentle Rain on Leaves with Soft Wind and Suburban Ambience](https://freesound.org/people/Garuda1982/sounds/757276/) | Garuda1982 |
| waves.m4a | [Waves On The Beach (Sand Wash)](https://freesound.org/people/ralph.whitehead/sounds/470648/) | ralph.whitehead |
| stream.m4a | [Small stream in forest](https://freesound.org/people/Cinetony/sounds/559955/) | Cinetony |
| wind.m4a | [windy winter day, wind in trees, from distance](https://freesound.org/people/lwdickens/sounds/259968/) | lwdickens |
| fire.m4a | [Silencyo_CC_Fire in Fireplace_Close Up_Reverberant2](https://freesound.org/people/silencyo/sounds/81801/) | silencyo |
| birds.m4a | [Bird ambience. Coniferous forest dawn chorus.](https://freesound.org/people/SamsterBirdies/sounds/745273/) | SamsterBirdies |
| crickets.m4a | [Crickets At Night - Raw sound](https://freesound.org/people/Defelozedd94/sounds/522299/) | Defelozedd94 |

每个文件都是从原始录音中截取的一段，经 `Scripts/prepare_ambient_loops.swift` 处理：首尾交叉淡化成无缝循环、统一响度、压住个别尖峰，再编码为 160 kbps AAC。截取的起点和长度写在脚本的 `specs` 里。

更换素材时，把新的 `rain.mp3`、`waves.mp3` 等放进一个目录，然后运行：

```bash
swift Scripts/prepare_ambient_loops.swift <原始录音目录> Resources/Ambient
```
