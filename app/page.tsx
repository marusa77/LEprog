import type { Metadata } from "next";
import { LearningApp } from "./learning-app";

export const metadata: Metadata = {
  title: "PhraseNest | Redditで見つけた英語を、自分の言葉に",
  description: "Redditで出会った英文・単語・熟語を保存して復習する英語学習アプリ",
};

export default function Home() {
  return <LearningApp />;
}
