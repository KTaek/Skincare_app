import React, { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors } from '../theme';
import { getMemo, MemoTarget, memoKeyOf, setMemo, useMemosHydrated } from './memoStore';

/**
 * 기록 카드 안에 얹는 메모 한 장.
 *
 * 접어 두면 한 줄만 차지하고(글이 있으면 첫 줄 미리보기), 눌러서 펼치면 입력칸이 나온다.
 * 기록 목록이 길어지는 걸 막으려고 기본은 접힘이고, 이미 쓴 메모가 있는 자리만 펼쳐 둔다.
 */
export default function MemoBlock({ target, placeholder }: { target: MemoTarget; placeholder: string }) {
  const hydrated = useMemosHydrated();
  // 저장소를 다 읽은 순간(그리고 대상이 바뀔 때) 값을 새로 읽도록 다시 세운다
  return <MemoEditor key={`${memoKeyOf(target)}-${hydrated}`} target={target} placeholder={placeholder} />;
}

/**
 * 입력 중에는 이 컴포넌트의 state가 원본이고 저장소에는 흘려보내기만 한다 — 저장소 값을 그대로
 * 되돌려 넣으면 한글 조합 중에 글자가 튀기 때문이다.
 */
function MemoEditor({ target, placeholder }: { target: MemoTarget; placeholder: string }) {
  const [text, setText] = useState(() => getMemo(target));
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(() => getMemo(target) !== '');

  const onChange = (v: string) => {
    setText(v);
    setMemo(target, v);
  };

  return (
    <View style={styles.root}>
      <Pressable style={styles.header} onPress={() => setOpen((v) => !v)} hitSlop={4}>
        <MaterialIcons name="edit-note" size={16} color={text !== '' ? AppColors.greenMuted : AppColors.sub} />
        <Text style={styles.title}>메모</Text>
        {!open && (
          <Text style={styles.peek} numberOfLines={1}>
            {text !== '' ? text : placeholder}
          </Text>
        )}
        <View style={{ flex: 1 }} />
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={20} color={AppColors.sub} />
      </Pressable>

      {open && (
        <>
          <View style={{ height: 8 }} />
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={onChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            placeholderTextColor={AppColors.sub}
            multiline
            textAlignVertical="top"
          />
          {focused && (
            <Pressable style={styles.done} onPress={() => Keyboard.dismiss()}>
              <Text style={styles.doneText}>완료</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: 14, borderTopWidth: 1, borderTopColor: AppColors.line, paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 12.5, fontWeight: '700', color: AppColors.sub, marginLeft: 6 },
  peek: { flexShrink: 1, fontSize: 12, color: AppColors.sub, marginLeft: 8 },
  input: {
    minHeight: 74,
    borderRadius: 12,
    backgroundColor: '#F4F6F9',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13.5,
    lineHeight: 20,
    color: AppColors.ink,
  },
  done: {
    alignSelf: 'flex-end',
    marginTop: 8,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: AppColors.greenTop,
  },
  doneText: { fontSize: 12.5, fontWeight: '800', color: '#16320A' },
});
