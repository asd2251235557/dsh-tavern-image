import test from 'node:test'
import assert from 'node:assert/strict'
import { collectNovelAiCharCaptions, compileChannelJob } from '../lib/index.js'
import { buildPlannerSystem } from '../lib/planner.js'

const definitions = () => ({
  characters: [
    {
      id: 'c1',
      name: '小玉',
      match: 'xiao yu',
      enabled: true,
      traits: {
        feature: 'gentle, elegant',
        face: 'long black hair, blue eyes, pale skin, young woman',
        faceBack: 'long black hair, nape, pale skin, young woman',
        bodySFW: 'slender body, medium breasts',
        bodySFWBack: 'slim waist, shoulder blades',
        lowerSFW: 'long legs',
        lowerSFWBack: 'rounded hips, long legs',
        bodyNSFW: '', bodyNSFWBack: '', lowerNSFW: '', lowerNSFWBack: '',
        negative: 'glasses',
      },
      outfits: [{ id: 'o1', name: 'white blouse', enabled: true, default: true, upper: 'white blouse', lower: 'black skirt', shoes: 'black heels', accessory: '' }],
      current: {},
    },
    {
      id: 'c2',
      name: '阿岚',
      match: 'alan',
      enabled: true,
      traits: {
        feature: 'cold',
        face: 'short brown hair, green eyes, pale skin, young man',
        faceBack: 'short brown hair, nape, pale skin, young man',
        bodySFW: 'tall, broad shoulders',
        bodySFWBack: 'wide back',
        lowerSFW: 'long legs',
        lowerSFWBack: 'long legs',
        bodyNSFW: '', bodyNSFWBack: '', lowerNSFW: '', lowerNSFWBack: '',
        negative: 'glasses',
      },
      outfits: [],
      current: { outfit: 'dark grey t-shirt' },
    },
  ],
})

const macroRaw = 'café table by the window, ${"name":"xiao yu","angle":"from front","upperBody":"sfw","lowerBody":"sfw"}$, ${"name":"alan","angle":"from front","upperBody":"sfw","lowerBody":"sfw"}$, 1girl, 1boy, indoors, warm light'
const expandedTag = 'café table by the window, gentle, elegant, long black hair, blue eyes, pale skin, young woman, slender body, medium breasts, long legs, white blouse, black skirt, black heels, from front, cold, short brown hair, green eyes, pale skin, young man, tall, broad shoulders, long legs, dark grey t-shirt, from front, 1girl, 1boy, indoors, warm light'
const baseConfig = { imageBackend: 'novelai', promptMode: 'tags', traitMode: 'default', weightMode: 'keep', sizes: {} }
const params = { tag: expandedTag, rawTag: macroRaw, artist: '', negative: '', size: '832x1216' }
const channel = (options = {}) => ({ provider: 'novelai', baseUrl: 'https://image.test', options })

test('NovelAI 分区按宏角色拆出稳定外貌与服装，base 不再重复', () => {
  const split = collectNovelAiCharCaptions({ rawTag: macroRaw, text: expandedTag, definitions: definitions(), config: baseConfig, promptMode: 'tags' })
  assert.equal(split.captions.length, 2)
  const [first, second] = split.captions
  assert.equal(first.id, 'c1')
  assert.match(first.prompt, /long black hair/)
  assert.match(first.prompt, /white blouse/)
  assert.equal(second.id, 'c2')
  assert.match(second.prompt, /short brown hair/)
  assert.match(second.prompt, /dark grey t-shirt/)
  // 两个人共有的特征各自保留一份，不会因为全局去重从后一个人身上消失。
  assert.match(first.prompt, /pale skin/)
  assert.match(second.prompt, /pale skin/)
  // base 只留场景、镜头与人数；角色外貌和服装不重复出现。
  assert.match(split.base, /café table by the window/)
  assert.match(split.base, /1girl, 1boy/)
  assert.doesNotMatch(split.base, /long black hair/)
  assert.doesNotMatch(split.base, /white blouse/)
  assert.doesNotMatch(split.base, /short brown hair/)
})

test('只在正文里写了名字、没用宏的角色也会补成分区', () => {
  const text = 'café table by the window, xiao yu smiles, warm light'
  const split = collectNovelAiCharCaptions({ rawTag: text, text, definitions: definitions(), config: baseConfig, promptMode: 'tags' })
  assert.equal(split.captions.length, 1)
  assert.equal(split.captions[0].id, 'c1')
  assert.match(split.captions[0].prompt, /long black hair/)
  assert.doesNotMatch(split.base, /long black hair/)
})

test('没有匹配到库中角色时不产生分区，提示词保持原样', () => {
  const text = '1girl, standing on the roof, sunset'
  const split = collectNovelAiCharCaptions({ rawTag: text, text, definitions: definitions(), config: baseConfig, promptMode: 'tags' })
  assert.deepEqual(split.captions, [])
  assert.equal(split.base, text)
})

test('compileChannelJob 对 NovelAI 渠道输出 charCaptions，负面词跟着角色走', () => {
  const compiled = compileChannelJob({ params, config: baseConfig, definitions: definitions(), channel: channel() })
  assert.equal(compiled.positive, 'café table by the window, from front, 1girl, 1boy, indoors, warm light')
  assert.equal(compiled.charCaptions.length, 2)
  assert.match(compiled.charCaptions[0].prompt, /white blouse/)
  assert.equal(compiled.charCaptions[0].negative, 'glasses')
  // 角色负面词不再进整图负面（多人画面里会互相压掉对方的特征）。
  assert.doesNotMatch(compiled.negative, /glasses/)
})

test('渠道设置关掉分区时沿用单串提示词', () => {
  const compiled = compileChannelJob({ params, config: baseConfig, definitions: definitions(), channel: channel({ charCaptions: false }) })
  assert.deepEqual(compiled.charCaptions, [])
  assert.match(compiled.positive, /long black hair/)
})

test('单图重绘沿用源作业的角色分区，base 里不还原人物外貌', () => {
  const sourceCaptions = [{ id: 'c1', name: '小玉', prompt: 'long black hair, blue eyes, white blouse', negative: 'glasses' }]
  const edited = 'café table by the window, long black hair, blue eyes, white blouse, 1girl, warm light'
  const compiled = compileChannelJob({
    params: { tag: edited, rawTag: edited, artist: '', negative: '', size: '832x1216', charCaptions: sourceCaptions },
    config: baseConfig,
    definitions: { characters: [] },
    channel: channel(),
  })
  assert.equal(compiled.charCaptions.length, 1)
  assert.equal(compiled.charCaptions[0].id, 'c1')
  assert.equal(compiled.positive, 'café table by the window, 1girl, warm light')
})

test('非 NovelAI 渠道不生成分区', () => {
  const config = { ...baseConfig, imageBackend: 'openai', promptMode: 'natural' }
  const compiled = compileChannelJob({ params, config, definitions: definitions(), channel: { provider: 'openai', options: {} } })
  assert.deepEqual(compiled.charCaptions, [])
})

test('开启分区时规划提示词补一段角色分工说明', () => {
  const withCaptions = buildPlannerSystem({ rules: 'R', roster: '- A [stable_id=1]', count: 2, charCaptions: true })
  assert.match(withCaptions, /<角色分区（NovelAI）>/)
  assert.ok(withCaptions.indexOf('<角色分区（NovelAI）>') < withCaptions.indexOf('<本次任务>'))
  const without = buildPlannerSystem({ rules: 'R', roster: '- A [stable_id=1]', count: 2 })
  assert.doesNotMatch(without, /<角色分区（NovelAI）>/)
})
