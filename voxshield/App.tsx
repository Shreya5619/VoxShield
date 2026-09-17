import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { 
  StyleSheet, 
  Text, 
  View, 
  SafeAreaView, 
  TextInput, 
  TouchableOpacity,
  FlatList,
  Alert,
  ScrollView,
  Platform,
  PermissionsAndroid
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type FamilyMember = {
  id: string;
  name: string;
  phoneNumber: string;
  relation: string;
  securityQuestion: string;
  securityAnswer: string;
};

type Tab = 'family' | 'home';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('family');
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [isReady, setIsReady] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [relation, setRelation] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [isRecording, setIsRecording] = useState(false);

  // Load family members from storage on mount
  useEffect(() => {
    const initApp = async () => {
      try {
        const storedMembers = await AsyncStorage.getItem('familyMembers');
        if (storedMembers) {
          try {
            setFamilyMembers(JSON.parse(storedMembers));
          } catch (parseError) {
            console.log('Failed to parse stored members');
          }
        }
      } catch (error) {
        console.log('Error loading family members');
      } finally {
        setIsReady(true);
      }
    };
    initApp();
  }, []);

  const saveFamilyMember = () => {
    if (!name.trim() || !phoneNumber.trim() || !relation.trim()) {
      Alert.alert('Missing Information', 'Please fill in name, phone number, and relation.');
      return;
    }

    const phoneDigits = phoneNumber.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      Alert.alert('Invalid Phone Number', 'Please enter a valid 10-digit phone number.');
      return;
    }

    const newMember: FamilyMember = {
      id: Date.now().toString(),
      name,
      phoneNumber: phoneDigits,
      relation,
      securityQuestion: securityQuestion.trim() || 'What is your birth city?',
      securityAnswer: securityAnswer.trim() || 'Default',
    };

    const updatedMembers = [...familyMembers, newMember];
    setFamilyMembers(updatedMembers);
    
    AsyncStorage.setItem('familyMembers', JSON.stringify(updatedMembers))
      .then(() => {
        Alert.alert('Success', 'Family member added!');
        setName('');
        setPhoneNumber('');
        setRelation('');
        setSecurityQuestion('');
        setSecurityAnswer('');
      })
      .catch(() => {
        Alert.alert('Error', 'Failed to save.');
      });
  };

  const deleteFamilyMember = (id: string) => {
    const updatedMembers = familyMembers.filter(member => member.id !== id);
    setFamilyMembers(updatedMembers);
    
    AsyncStorage.setItem('familyMembers', JSON.stringify(updatedMembers))
      .then(() => {
        Alert.alert('Deleted', 'Member removed.');
      })
      .catch(() => {
        Alert.alert('Error', 'Failed to delete.');
      });
  };

  const startRecording = (callerType: 'family' | 'spammer') => {
    if (isRecording) return;
    
    if (Platform.OS === 'android') {
      PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Audio Recording Permission',
          message: 'VoxShield needs microphone access.',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      ).then((granted) => {
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          setIsRecording(true);
          Alert.alert('Recording', `Recording ${callerType} call started.`);
        } else {
          Alert.alert('Permission', 'Microphone permission required.');
        }
      });
    } else {
      setIsRecording(true);
      Alert.alert('Recording', `Recording ${callerType} call started.`);
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    Alert.alert('Done', 'Recording saved locally.');
  };

  const renderFamilyMember = ({ item }: { item: FamilyMember }) => (
    <View style={styles.memberCard}>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{item.name}</Text>
        <Text style={styles.memberDetails}>📞 {item.phoneNumber}</Text>
        <Text style={styles.memberDetails}>👥 {item.relation}</Text>
        {item.securityQuestion ? (
          <Text style={styles.securityDetails}>🔒 {item.securityQuestion}</Text>
        ) : null}
      </View>
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => deleteFamilyMember(item.id)}
      >
        <Text style={styles.deleteButtonText}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  if (!isReady) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'family' && styles.activeTab]}
          onPress={() => setActiveTab('family')}
        >
          <Text style={[styles.tabText, activeTab === 'family' && styles.activeTabText]}>
            👨‍👩‍👧‍👦 Family
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.tab, activeTab === 'home' && styles.activeTab]}
          onPress={() => setActiveTab('home')}
        >
          <Text style={[styles.tabText, activeTab === 'home' && styles.activeTabText]}>
            🏠 Home
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'family' && (
        <ScrollView style={styles.tabContent}>
          <View style={styles.formContainer}>
            <Text style={styles.sectionTitle}>Add Family Member</Text>
            
            <TextInput
              style={styles.input}
              placeholder="Name"
              value={name}
              onChangeText={setName}
              placeholderTextColor="#999"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Phone Number (10 digits)"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              placeholderTextColor="#999"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Relation"
              value={relation}
              onChangeText={setRelation}
              placeholderTextColor="#999"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Security Question"
              value={securityQuestion}
              onChangeText={setSecurityQuestion}
              placeholderTextColor="#999"
            />
            
            <TextInput
              style={styles.input}
              placeholder="Security Answer"
              value={securityAnswer}
              onChangeText={setSecurityAnswer}
              secureTextEntry
              placeholderTextColor="#999"
            />
            
            <TouchableOpacity style={styles.addButton} onPress={saveFamilyMember}>
              <Text style={styles.addButtonText}>Add Member</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.listContainer}>
            <Text style={styles.sectionTitle}>
              Members ({familyMembers.length})
            </Text>
            
            {familyMembers.length === 0 ? (
              <Text style={styles.emptyText}>
                No members added yet.
              </Text>
            ) : (
              <FlatList
                data={familyMembers}
                renderItem={renderFamilyMember}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
              />
            )}
          </View>
        </ScrollView>
      )}

      {activeTab === 'home' && (
        <View style={styles.tabContent}>
          <View style={styles.homeContainer}>
            <Text style={styles.homeTitle}>VoxShield</Text>
            <Text style={styles.homeSubtitle}>
              {isRecording ? '🔴 Recording...' : 'Start recording a call'}
            </Text>
            
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.callButton, styles.familyButton]}
                onPress={() => startRecording('family')}
                disabled={isRecording}
              >
                <Text style={styles.callButtonText}>📞 Family Call</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.callButton, styles.spammerButton]}
                onPress={() => startRecording('spammer')}
                disabled={isRecording}
              >
                <Text style={styles.callButtonText}>🚫 Spammer Call</Text>
              </TouchableOpacity>
            </View>
            
            {isRecording && (
              <TouchableOpacity style={styles.stopButton} onPress={stopRecording}>
                <Text style={styles.stopButtonText}>Stop Recording</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: { flex: 1, paddingVertical: 16, alignItems: 'center' },
  activeTab: { borderBottomWidth: 3, borderBottomColor: '#007AFF' },
  tabText: { fontSize: 16, color: '#666' },
  activeTabText: { color: '#007AFF', fontWeight: 'bold' },
  tabContent: { flex: 1 },
  formContainer: {
    backgroundColor: '#fff',
    padding: 20,
    margin: 16,
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  input: {
    backgroundColor: '#f8f8f8',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  addButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  listContainer: { padding: 16 },
  emptyText: { textAlign: 'center', color: '#666', fontSize: 16, marginTop: 20 },
  memberCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 4 },
  memberDetails: { fontSize: 14, color: '#666', marginBottom: 2 },
  securityDetails: { fontSize: 12, color: '#888', marginTop: 4 },
  deleteButton: {
    backgroundColor: '#ff3b30',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  deleteButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  homeContainer: { flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' },
  loadingContainer: { flex: 1, backgroundColor: '#f5f5f5', alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 18, color: '#666' },
  homeTitle: { fontSize: 28, fontWeight: 'bold', color: '#333', marginBottom: 8, textAlign: 'center' },
  homeSubtitle: { fontSize: 16, color: '#666', marginBottom: 40, textAlign: 'center' },
  buttonContainer: { width: '100%', gap: 20 },
  callButton: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  familyButton: { borderWidth: 3, borderColor: '#4CD964' },
  spammerButton: { borderWidth: 3, borderColor: '#FF3B30' },
  callButtonText: { fontSize: 20, fontWeight: 'bold', marginBottom: 8, color: '#333' },
  stopButton: {
    backgroundColor: '#FF3B30',
    padding: 20,
    borderRadius: 12,
    marginTop: 30,
    width: '100%',
    alignItems: 'center',
  },
  stopButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});
