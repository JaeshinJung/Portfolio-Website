// firebase-config.js

// 1. CDN 주소를 통해 Firebase 기능 불러오기
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// 2. 발급받은 내 프로젝트 설정값
const firebaseConfig = {
    apiKey: "AIzaSyCfTAmMOi8ZULfiVAxiFum1EZ7nsuzD3TI",
    authDomain: "portfolio-website-d6c34.firebaseapp.com",
    projectId: "portfolio-website-d6c34",
    storageBucket: "portfolio-website-d6c34.firebasestorage.app",
    messagingSenderId: "188404068045",
    appId: "1:188404068045:web:c0afa0d75998bc2e0b4384",
    measurementId: "G-14JVZMWJFV"
};

// 3. Firebase 초기화 및 다른 파일에서 쓸 수 있게 내보내기(export)
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);