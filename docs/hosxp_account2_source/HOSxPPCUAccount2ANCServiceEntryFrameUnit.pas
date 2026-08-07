unit HOSxPPCUAccount2ANCServiceEntryFrameUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, cxGraphics, cxLookAndFeels, cxLookAndFeelPainters, Menus,
  dxSkinsCore, dxSkinsDefaultPainters, StdCtrls, cxButtons, ExtCtrls,
  JvExControls, JvNavigationPane, cxControls, cxContainer, cxEdit, cxGroupBox,
  DB, DBClient, cxTextEdit, cxDBEdit, cxLabel, cxMaskEdit, cxDropDownEdit,
  cxLookupEdit, cxDBLookupEdit, cxDBLookupComboBox, dxSkinscxPCPainter,
  cxCheckBox, cxSpinEdit, cxPC, cxTimeEdit, cxCalendar, OneStopServiceDMU,
  dxLayoutcxEditAdapters, dxLayoutContainer, dxLayoutLookAndFeels, cxClasses,
  dxLayoutControl, cxMemo, dxBarBuiltInMenu;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}

type
  THOSxPPCUAccount2ANCServiceEntryFrame = class(TFrame)
    PersonANCServiceCDS: TClientDataSet;
    PersonANCServiceDS: TDataSource;
    cxPageControl1: TcxPageControl;
    ScreenTabSheet: TcxTabSheet;
    cxTabSheet2: TcxTabSheet;
    PersonANCScreenCDS: TClientDataSet;
    PersonANCScreenDS: TDataSource;
    VisitTabSheet: TcxTabSheet;
    PersonANCCDS: TClientDataSet;
    PersonANCDS: TDataSource;
    dxLayoutControl1Group_Root: TdxLayoutGroup;
    dxLayoutControl1: TdxLayoutControl;
    dxLayoutLookAndFeelList1: TdxLayoutLookAndFeelList;
    dxLayoutSkinLookAndFeel1: TdxLayoutSkinLookAndFeel;
    dxLayoutControl1Item1: TdxLayoutItem;
    cxGroupBox1: TcxGroupBox;
    Label2: TLabel;
    Label3: TLabel;
    Label4: TLabel;
    Label5: TLabel;
    cxDBTextEdit2: TcxDBTextEdit;
    cxDBTextEdit3: TcxDBComboBox;
    cxDBTextEdit4: TcxDBComboBox;
    cxDBLookupComboBox1: TcxDBLookupComboBox;
    dxLayoutControl1Item2: TdxLayoutItem;
    cxGroupBox3: TcxGroupBox;
    Label6: TLabel;
    Label7: TLabel;
    Label8: TLabel;
    Label9: TLabel;
    Label11: TLabel;
    cxDBLookupComboBox2: TcxDBLookupComboBox;
    cxDBTextEdit5: TcxDBTextEdit;
    cxDBSpinEdit1: TcxDBSpinEdit;
    cxDBLookupComboBox3: TcxDBLookupComboBox;
    cxDBCheckBox16: TcxDBCheckBox;
    cxDBCheckBox17: TcxDBCheckBox;
    cxDBCheckBox18: TcxDBCheckBox;
    dxLayoutControl1Item3: TdxLayoutItem;
    cxGroupBox2: TcxGroupBox;
    cxDBCheckBox1: TcxCheckBox;
    cxDBCheckBox2: TcxCheckBox;
    cxDBCheckBox3: TcxCheckBox;
    cxDBCheckBox4: TcxCheckBox;
    cxDBCheckBox5: TcxCheckBox;
    cxDBCheckBox6: TcxCheckBox;
    cxDBCheckBox7: TcxCheckBox;
    cxDBCheckBox8: TcxCheckBox;
    cxDBCheckBox9: TcxCheckBox;
    cxDBCheckBox10: TcxCheckBox;
    dxLayoutControl1Item4: TdxLayoutItem;
    cxGroupBox8: TcxGroupBox;
    Label21: TLabel;
    cxDBCheckBox11: TcxDBCheckBox;
    cxDBCheckBox12: TcxDBCheckBox;
    cxDBCheckBox13: TcxDBCheckBox;
    cxDBCheckBox14: TcxDBCheckBox;
    cxDBCheckBox15: TcxDBCheckBox;
    cxDBSpinEdit2: TcxDBSpinEdit;
    cxTabSheet1: TcxTabSheet;
    cxTabSheet3: TcxTabSheet;
    cxTabSheet4: TcxTabSheet;
    cxTabSheet5: TcxTabSheet;
    DxGroupBox: TcxGroupBox;
    MedicationGroupBox: TcxGroupBox;
    LabGroupBox: TcxGroupBox;
    cxButton1: TcxButton;
    AppointmentTabSheet: TcxTabSheet;
    Petabsheet: TcxTabSheet;
    dxLayoutControl2Group_Root: TdxLayoutGroup;
    dxLayoutControl2: TdxLayoutControl;
    PatientInformationDetailGroupBox: TcxGroupBox;
    dxLayoutControl2Item1: TdxLayoutItem;
    dxLayoutControl2Item2: TdxLayoutItem;
    cxGroupBox4: TcxGroupBox;
    Label10: TLabel;
    Label12: TLabel;
    Label13: TLabel;
    Label14: TLabel;
    Label15: TLabel;
    cxDBLookupComboBox4: TcxDBLookupComboBox;
    cxDBLookupComboBox5: TcxDBLookupComboBox;
    cxDBTextEdit6: TcxDBTextEdit;
    cxDBDateEdit1: TcxDBDateEdit;
    cxDBTimeEdit1: TcxDBTimeEdit;
    dxLayoutControl2Item3: TdxLayoutItem;
    VisitGroupBox: TcxGroupBox;
    VaccineTabSheet: TcxTabSheet;
    cxGroupBox5: TcxGroupBox;
    dxLayoutItem1: TdxLayoutItem;
    cxDBMemo1: TcxDBMemo;
    DentalCareTabSheet: TcxTabSheet;
    ANCLabTabSheet: TcxTabSheet;
    PersonANCLabCDS: TClientDataSet;
    ShowAllButton: TcxButton;
    cxDBCheckBox19: TcxDBCheckBox;
    cxDBSpinEdit3: TcxDBSpinEdit;
    Label1: TLabel;

    procedure PersonANCServiceCDSBeforePost(DataSet: TDataSet);
    procedure LogViewButtonClick(Sender: TObject);
    procedure PersonANCScreenCDSBeforePost(DataSet: TDataSet);
    procedure PersonANCServiceCDSNewRecord(DataSet: TDataSet);
    procedure cxTabSheet4Show(Sender: TObject);
    procedure cxButton1Click(Sender: TObject);
    procedure AppointmentTabSheetShow(Sender: TObject);
    procedure PetabsheetShow(Sender: TObject);
    procedure VaccineTabSheetShow(Sender: TObject);
    procedure DentalCareTabSheetShow(Sender: TObject);
    procedure ANCLabTabSheetShow(Sender: TObject);
    procedure PersonANCLabCDSBeforePost(DataSet: TDataSet);
    procedure ShowAllButtonClick(Sender: TObject);
  private

    FVN: String;

    FOneStopServiceDM: TOneStopServiceDM;
    HOSxPSubModuleOneStopServiceDM: TDataModule;

    FDoctorWorkBenchNurseScreenFrame: TFrame;
    FMedicationOrderFrame: TFrame;

    FPatientInformationFrame: TFrame;

    FHOSxPPCUVisitEntryFrame: TFrame;
    FHOSxPSubModuleOneStopServiceDiagnosisEntryFrame: TFrame;
    FDoctorWorkBenchPhysicalExaminationEntryFrame: TFrame;
    FHOSxPLabOrderHistoryListFrame: TFrame;
    FAppointmentFrame: TFrame;
    FPersonANCServiceID: Integer;
    FPersonANCID: Integer;

    FHOSxPPCUAccount2PersonAncServiceDetailListFrame: TFrame;

    FHOSxPDentalCareListFrame: TFrame;

    FHOSxPPCUAccount2PersonANCLabListFrame: TFrame;

    procedure InitializeDatamodule;

    procedure SetPersonANCServiceID(const Value: Integer);
    procedure RefreshData;

    procedure SetPersonANCID(const Value: Integer);
    { Private declarations }
  public
    { Public declarations }
    property PersonANCServiceID: Integer read FPersonANCServiceID
      write SetPersonANCServiceID;
    property PersonANCID: Integer read FPersonANCID write SetPersonANCID;
    property OneStopServiceDM: TOneStopServiceDM read FOneStopServiceDM;
    procedure DoSaveData;
    procedure DoDeleteData;

    procedure DoClearInvalidVisit;
    class procedure SetDoctorWorkBenchMode(b: boolean);
  end;

implementation

uses HOSxPDMU, BMSApplicationUtil, HOSxPPCUAccount2DataModuleUnit, Math;

{$R *.dfm}
{ THOSxPSystemSettingIPDBedEntryForm }

var
  FDoctorWorkBenchMode: boolean;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.PersonANCLabCDSBeforePost(
  DataSet: TDataSet);
begin
  if (dataset.State in [dsinsert]) then
  begin
   repeat
    dataset.FieldByName('person_anc_lab_id').AsInteger:=
     getserialnumber('person_anc_lab_id');
   until getsqldata('select count(*) as cc from person_anc_lab where person_anc_lab_id = '+
    inttostr(dataset.FieldByName('person_anc_lab_id').AsInteger))=0;
  end;

  dataset.FieldByName('person_anc_service_id').AsInteger:=FPersonANCServiceID;

end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.PersonANCScreenCDSBeforePost
  (DataSet: TDataSet);
begin
  if (DataSet.State in [dsinsert]) then
  begin
    repeat
      DataSet.FieldByName('person_anc_screen_id').AsInteger :=
        getserialnumber('person_anc_screen_id');
    until getsqldata
      ('select count(*) as cc from person_anc_screen where person_anc_screen_id = '
      + DataSet.FieldByName('person_anc_screen_id').asstring) = 0;
  end;

  DataSet.FieldByName('person_anc_service_id').AsInteger := FPersonANCServiceID;
end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.PersonANCServiceCDSBeforePost
  (DataSet: TDataSet);
begin
  if (DataSet.State in [dsinsert]) then
  begin
    DataSet.FieldByName('person_anc_service_id').AsInteger :=
      FPersonANCServiceID;
  end;

  DataSet.FieldByName('person_anc_id').AsInteger := FPersonANCID;

  if dataset.FieldByName('service_result').AsString='' then

  dataset.FieldByName('service_result').AsString:='Y';

end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.PersonANCServiceCDSNewRecord
  (DataSet: TDataSet);
begin
  DataSet.FieldByName('anc_service_type_id').AsInteger := 1;
  DataSet.FieldByName('anc_location_type_id').AsInteger := 1;
  dataset.FieldByName('service_result').AsString:='Y';
end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.LogViewButtonClick
  (Sender: TObject);
begin
  SafeLoadPackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm',
    'DoShowForm', ['"person_anc_service"', inttostr(FPersonANCServiceID)]);
end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.ANCLabTabSheetShow
  (Sender: TObject);
begin
  if not assigned(FHOSxPPCUAccount2PersonANCLabListFrame) then
  begin
    FHOSxPPCUAccount2PersonANCLabListFrame :=
      TFrame(ExecuteRTTIFunction
      ('HOSxPPCUAccount2PersonANCLabListFrameUnit.THOSxPPCUAccount2PersonANCLabListFrame',
      'Create', [ANCLabTabSheet]).AsObject);
    FHOSxPPCUAccount2PersonANCLabListFrame.Parent := ANCLabTabSheet;
    FHOSxPPCUAccount2PersonANCLabListFrame.Align := alclient;

    SetRTTIObjectProperty(FHOSxPPCUAccount2PersonANCLabListFrame,
      'VN', self.Fvn);

    SetRTTIObjectProperty(FHOSxPPCUAccount2PersonANCLabListFrame,
      'PersonANCServiceID', self.FPersonANCServiceID);
  end;
end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.AppointmentTabSheetShow
  (Sender: TObject);
begin
  SafeLoadPackage('HOSxPAppointmentPackage.bpl');

  if not assigned(FAppointmentFrame) then
  begin
    SafeLoadPackage('HOSxPDrugAllergyPackage.bpl');
    FAppointmentFrame :=
      TFrame(ExecuteRTTIFunction
      ('HOSxPAppointmentListFrameUnit.THOSxPAppointmentListFrame', 'Create',
      [self]).AsObject);
    FAppointmentFrame.Parent := AppointmentTabSheet;
    FAppointmentFrame.Align := alclient;

  end;

  SetRTTIObjectProperty(FAppointmentFrame, 'VN', FVN);

end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.cxButton1Click(Sender: TObject);
begin
  SafeLoadPackage('HOSxPRadiologyPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPRadiologyRequestMainFormUnit.THOSxPRadiologyRequestMainForm',
    'DoShowForm', [self.FVN]);
end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.cxTabSheet4Show
  (Sender: TObject);
begin

  if not assigned(FHOSxPLabOrderHistoryListFrame) then
  begin

    SafeLoadPackage('HOSxPLabOrderPackage.bpl');

    FHOSxPLabOrderHistoryListFrame :=
      TFrame(ExecuteRTTIFunction
      ('HOSxPLabOrderHistoryListFrameUnit.THOSxPLabOrderHistoryListFrame',
      'Create', [LabGroupBox]).AsObject);
    FHOSxPLabOrderHistoryListFrame.Parent := LabGroupBox;
    FHOSxPLabOrderHistoryListFrame.Align := alclient;
    SetRTTIObjectProperty(FHOSxPLabOrderHistoryListFrame, 'VN', FVN);

  end;
end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.PetabsheetShow(Sender: TObject);
begin
  if not assigned(FDoctorWorkBenchPhysicalExaminationEntryFrame) then
  begin

    SafeLoadPackage('HOSxPDoctorWorkbenchPackage.bpl');
    FDoctorWorkBenchPhysicalExaminationEntryFrame :=
      TFrame(ExecuteRTTIFunction
      ('DoctorWorkBenchPhysicalExaminationEntryFrameUnit.TDoctorWorkBenchPhysicalExaminationEntryFrame',
      'Create', [Petabsheet]).AsObject);
    FDoctorWorkBenchPhysicalExaminationEntryFrame.Parent := Petabsheet;
    FDoctorWorkBenchPhysicalExaminationEntryFrame.Align := alclient;

    SetRTTIObjectProperty(FDoctorWorkBenchPhysicalExaminationEntryFrame, 'VN',
      self.FVN);
    SetRTTIObjectProperty(FDoctorWorkBenchPhysicalExaminationEntryFrame,
      'OneStopServiceDM', self.FOneStopServiceDM);
  end;
end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.DentalCareTabSheetShow
  (Sender: TObject);
begin
  if not assigned(FHOSxPDentalCareListFrame) then
  begin
    SafeLoadPackage('HOSxPDentalPackage.bpl');
    FHOSxPDentalCareListFrame :=
      TFrame(ExecuteRTTIFunction
      ('HOSxPDentalCareListFrameUnit.THOSxPDentalCareListFrame', 'Create',
      [DentalCareTabSheet]).AsObject);
    FHOSxPDentalCareListFrame.Parent := DentalCareTabSheet;
    FHOSxPDentalCareListFrame.Align := alclient;

    SetRTTIObjectProperty(FHOSxPDentalCareListFrame, 'VN', self.FVN);
  end;
end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.DoClearInvalidVisit;
begin
  if getsqldata
    ('select count(*) as cc from person_anc_service where person_anc_service_id = '
    + inttostr(FPersonANCServiceID)) = 0 then
  begin
    ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoDeleteData', []);
  end;

end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.DoDeleteData;
begin
  if (PersonANCServiceCDS.State in [dsinsert, dsedit]) then
  begin
    PersonANCServiceCDS.cancel;

  end;

  if PersonANCServiceCDS.recordcount > 0 then
    PersonANCServiceCDS.delete;

  if PersonANCServiceCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(PersonANCServiceCDS,
      'select * from person_anc_service where person_anc_service_id = ' +
      inttostr(FPersonANCServiceID), '', '', '');
    PersonANCServiceCDS.MergeChangeLog;
  end;
end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.DoSaveData;
var
  i: Integer;
  ic1: Integer;
  tc: TClientDataSet;
begin
  if (PersonANCServiceCDS.State in [dsinsert, dsedit]) then
  begin
    PersonANCServiceCDS.post;

  end;

  if PersonANCServiceCDS.recordcount = 0 then
  begin
    showmessage('No data');
    abort;
  end;

  if PersonANCServiceCDS.FieldByName('vn').asstring <> '' then
  begin

    ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoSetVstDateTime',
      [PersonANCServiceCDS.FieldByName('anc_service_date').AsDateTime,
      PersonANCServiceCDS.FieldByName('anc_service_time').AsDateTime]);

    ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoSaveData', []);


     PersonANCServiceCDS.edit;
    PersonANCServiceCDS.FieldByName('anc_service_date').AsDateTime :=
      getsqldata('select vstdate from ovst where vn = "'+PersonANCServiceCDS.FieldByName('vn').asstring+'"');
    PersonANCServiceCDS.FieldByName('anc_service_time').AsDateTime :=
      getsqldata('select vsttime from ovst where vn = "'+PersonANCServiceCDS.FieldByName('vn').asstring+'"');
    PersonANCServiceCDS.post;

  end;
  PersonANCServiceCDS.edit;

  PersonANCServiceCDS.FieldByName('pa_week').AsInteger :=
   trunc( (trunc(PersonANCServiceCDS.FieldByName('anc_service_date').AsDateTime) -
    trunc(PersonANCCDS.FieldByName('lmp').AsDateTime)) / 7);

  PersonANCServiceCDS.FieldByName('pa_day').AsInteger :=
    (trunc(PersonANCServiceCDS.FieldByName('anc_service_date').AsDateTime) -
    trunc(PersonANCCDS.FieldByName('lmp').AsDateTime)) mod 7;

  if PersonANCServiceCDS.FieldByName('pa_week').AsInteger > 1000 then
    PersonANCServiceCDS.FieldByName('pa_week').AsInteger := 0;

  if getsqldata('select count(*) as cc from  person_anc_preg_week') = 0 then
  begin

    case PersonANCServiceCDS.FieldByName('pa_week').AsInteger of
      0 .. 27:
        PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger := 1;
      28 .. 31:
        PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger := 2;
      32 .. 35:
        PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger := 3;
      36 .. 99999:
        PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger := 4;
      // 33..9999: personancservicecds.fieldbyname('anc_service_number').asinteger :=
      // 5;

    end;
  end
  else
  begin
    try
      PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger :=
        getsqldata('select person_anc_preg_week_id ' +
        ' from person_anc_preg_week where week_min<=' +
        PersonANCServiceCDS.FieldByName('pa_week').asstring + ' and week_max>='
        + PersonANCServiceCDS.FieldByName('pa_week').asstring);
    except
      case PersonANCServiceCDS.FieldByName('pa_week').AsInteger of
        0 .. 27:
          PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger := 1;
        28 .. 31:
          PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger := 2;
        32 .. 35:
          PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger := 3;
        36 .. 99999:
          PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger := 4;
        // 33..9999: personancservicecds.fieldbyname('anc_service_number').asinteger :=
        // 5;

      end;
    end;

    if PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger = -1 then

      case PersonANCServiceCDS.FieldByName('pa_week').AsInteger of
        0 .. 27:
          PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger := 1;
        28 .. 31:
          PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger := 2;
        32 .. 35:
          PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger := 3;
        36 .. 99999:
          PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger := 4;
        // 33..9999: personancservicecds.fieldbyname('anc_service_number').asinteger :=
        // 5;

      end;

  end;

  PersonANCServiceCDS.FieldByName('pass_quality').asstring :=
    boolean2char
    (getsqldata
    ('select count(*) as cc from person_anc_preg_week where person_anc_preg_week_id = '
    + inttostr(PersonANCServiceCDS.FieldByName('anc_service_number').AsInteger)
    + ' and week_min_quality<=' + inttostr(PersonANCServiceCDS.FieldByName
    ('pa_week').AsInteger) + ' and week_min_quality>=' +
    inttostr(PersonANCServiceCDS.FieldByName('pa_week').AsInteger)) > 0);

  // boolean2char( not ((personancservicecds.fieldbyname('pa_week').asinteger in [13,14,15,16,17,19,20,21,22,23,24,25,27,28,29,30,31,33,34,35,36,37,39,40]) or (personancservicecds.fieldbyname('pa_week').asinteger>40))  );
  PersonANCServiceCDS.FieldByName('service_text').asstring :=
    GetSQLCommaListText('select a.anc_service_name ' +
    ' from anc_service a,person_anc_service_detail d ' +
    ' where d.person_anc_service_id = ' + PersonANCServiceCDS.FieldByName
    ('person_anc_service_id').asstring +
    ' and a.anc_service_id = d.anc_service_id');

  PersonANCServiceCDS.post;

  if PersonANCServiceCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(PersonANCServiceCDS,
      'select * from person_anc_service where person_anc_service_id = ' +
      inttostr(FPersonANCServiceID), '', '', '');
    PersonANCServiceCDS.MergeChangeLog;
  end;

  if (PersonANCScreenCDS.State in [dsinsert, dsedit]) then
    PersonANCScreenCDS.post;

  if PersonANCScreenCDS.recordcount = 0 then
  begin
    PersonANCScreenCDS.append;
    PersonANCScreenCDS.post;
  end;

  PersonANCScreenCDS.edit;

  if PersonANCScreenCDS.recordcount > 0 then
  begin
    for i := 1 to 10 do
    begin
      if TcxCheckBox(findcomponent('cxDBCheckBox' + inttostr(i))).checked then
      begin
        if PersonANCScreenCDS.FieldByName('cc_text').asstring = '' then
          PersonANCScreenCDS.FieldByName('cc_text').asstring :=

            TcxCheckBox(findcomponent('cxDBCheckBox' + inttostr(i))).caption
        else
          PersonANCScreenCDS.FieldByName('cc_text').asstring :=
            PersonANCScreenCDS.FieldByName('cc_text').asstring + ',' +
            TcxCheckBox(findcomponent('cxDBCheckBox' + inttostr(i))).caption;
      end;
    end;

  end;

  PersonANCScreenCDS.post;

  if (PersonANCCDS.State in [dsedit]) then
    PersonANCCDS.post;

  PersonANCCDS.edit;
  try
    PersonANCCDS.FieldByName('pre_labor_service1_date').AsDateTime :=
      getsqldata('select anc_service_date from person_anc_service ' +
      ' where person_anc_id = ' + inttostr(FPersonANCID) +
      ' and  anc_service_number = 1');
  except
    PersonANCCDS.FieldByName('pre_labor_service1_date').asvariant := null;
  end;

  try
    if PersonANCCDS.FieldByName('pre_labor_service1_date').isnull then
      PersonANCCDS.FieldByName('pre_labor_service1_date').AsDateTime :=
        getsqldata('select precare_date from person_anc_other_precare ' +
        ' where person_anc_id = ' + inttostr(FPersonANCID) +
        ' and  precare_no = 1');
  except
    PersonANCCDS.FieldByName('pre_labor_service1_date').asvariant := null;
  end;

  try
    PersonANCCDS.FieldByName('pre_labor_service2_date').AsDateTime :=
      getsqldata('select anc_service_date from person_anc_service ' +
      ' where person_anc_id = ' + inttostr(FPersonANCID) +
      ' and  anc_service_number = 2');
  except
    PersonANCCDS.FieldByName('pre_labor_service2_date').asvariant := null;
  end;

  try
    if PersonANCCDS.FieldByName('pre_labor_service2_date').isnull then
      PersonANCCDS.FieldByName('pre_labor_service2_date').AsDateTime :=
        getsqldata('select precare_date from person_anc_other_precare ' +
        ' where person_anc_id = ' + inttostr(FPersonANCID) +
        ' and  precare_no = 2');
  except
    PersonANCCDS.FieldByName('pre_labor_service2_date').asvariant := null;
  end;

  try
    PersonANCCDS.FieldByName('pre_labor_service3_date').AsDateTime :=
      getsqldata('select anc_service_date from person_anc_service ' +
      ' where person_anc_id = ' + inttostr(FPersonANCID) +
      ' and  anc_service_number = 3');
  except
    PersonANCCDS.FieldByName('pre_labor_service3_date').asvariant := null;
  end;

  try
    if PersonANCCDS.FieldByName('pre_labor_service3_date').isnull then
      PersonANCCDS.FieldByName('pre_labor_service3_date').AsDateTime :=
        getsqldata('select precare_date from person_anc_other_precare ' +
        ' where person_anc_id = ' + inttostr(FPersonANCID) +
        ' and  precare_no = 3');
  except
    PersonANCCDS.FieldByName('pre_labor_service3_date').asvariant := null;
  end;

  try
    PersonANCCDS.FieldByName('pre_labor_service4_date').AsDateTime :=
      getsqldata('select anc_service_date from person_anc_service ' +
      ' where person_anc_id = ' + inttostr(FPersonANCID) +
      ' and  anc_service_number = 4');
  except
    PersonANCCDS.FieldByName('pre_labor_service4_date').asvariant := null;
  end;

  try
    if PersonANCCDS.FieldByName('pre_labor_service4_date').isnull then
      PersonANCCDS.FieldByName('pre_labor_service4_date').AsDateTime :=
        getsqldata('select precare_date from person_anc_other_precare ' +
        ' where person_anc_id = ' + inttostr(FPersonANCID) +
        ' and  precare_no = 4');
  except
    PersonANCCDS.FieldByName('pre_labor_service4_date').asvariant := null;
  end;

  try
    PersonANCCDS.FieldByName('pre_labor_service5_date').AsDateTime :=
      getsqldata('select anc_service_date from person_anc_service ' +
      ' where person_anc_id = ' + inttostr(FPersonANCID) +
      ' and  anc_service_number = 5');
  except
    PersonANCCDS.FieldByName('pre_labor_service5_date').asvariant := null;
  end;

  try
    if PersonANCCDS.FieldByName('pre_labor_service5_date').isnull then
      PersonANCCDS.FieldByName('pre_labor_service5_date').AsDateTime :=
        getsqldata('select precare_date from person_anc_other_precare ' +
        ' where person_anc_id = ' + inttostr(FPersonANCID) +
        ' and  precare_no = 5');
  except
    PersonANCCDS.FieldByName('pre_labor_service5_date').asvariant := null;
  end;

  // dental_tx_date
  try
    PersonANCCDS.FieldByName('dental_tx_date').AsDateTime :=
      getsqldata
      ('select a1.anc_service_date from person_anc_service a1,person_anc_screen a2'
      + ' where a1.person_anc_id = ' + inttostr(FPersonANCID) +
      ' and a1.person_anc_service_id = a2.person_anc_service_id and a2.dt_screen1="Y"');
  except
  end;

  ic1 := 0;
  if PersonANCCDS.FieldByName('pre_labor_service1_date').isnull then
    inc(ic1);
  if PersonANCCDS.FieldByName('pre_labor_service2_date').isnull then
    inc(ic1);
  if PersonANCCDS.FieldByName('pre_labor_service3_date').isnull then
    inc(ic1);
  if PersonANCCDS.FieldByName('pre_labor_service4_date').isnull then
    inc(ic1);
  // if personanccds.fieldbyname('pre_labor_service5_date').isnull then
  // inc(ic1);

  try
    PersonANCCDS.FieldByName('pre_labor_service_percent').asfloat := (4 - ic1)
      * 100 / 4;
  except
  end;

  PersonANCCDS.post;
  if PersonANCCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta(PersonANCCDS.delta,
      'select * from person_anc where person_anc_id = ' +
      inttostr(FPersonANCID));
    PersonANCCDS.data := hosxp_getdataset
      ('select * from person_anc where person_anc_id = ' +
      inttostr(FPersonANCID));
  end;

  if not FDoctorWorkBenchMode then

    ExecuteRTTIFunction('OPDSignDoctorEntryUnit.TOPDSignDoctorEntryForm',
      'DoShowFormWithVisitCDS', [FVN, nil, OneStopServiceDM.OVstCDS]);

  if assigned(FDoctorWorkBenchNurseScreenFrame) then
    ExecuteRTTIObjectMethod(FDoctorWorkBenchNurseScreenFrame, 'DoSaveData', []);

  if (OneStopServiceDM.OVstCDS.State in [dsinsert, dsedit]) then
    OneStopServiceDM.OVstCDS.post;
  // OneStopServiceDM.OVstCDS.edit;
  // OneStopServiceDM.OVstCDS.FieldByName('cur_dep').asstring :=
  // vartostr(getsqldata('select depcode from kskdepartment where department="' +
  // GetRTTIObjectProperty(FPatientInformationFrame,'CurDep').AsString + '"'));
  // OneStopServiceDM.OVstCDS.Post;

  // CurDep := GetRTTIObjectProperty(FPatientInformationFrame, 'CurDep').AsString;
  // OneStopServiceDM.OVstCDS.edit;
  // if CurDep <> '' then
  // OneStopServiceDM.OVstCDS.FieldByName('cur_dep').AsString := CurDep;
  // OneStopServiceDM.OVstCDS.Post;

  if OneStopServiceDM.OVstCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta(OneStopServiceDM.OVstCDS.delta,
      'select * from ovst where vn = "' + FVN + '"');
  end;

  if (OneStopServiceDM.OVstSeqCDS.State in [dsinsert, dsedit]) then
  begin
    OneStopServiceDM.OVstSeqCDS.post;
  end
  else
  begin
    if OneStopServiceDM.OVstSeqCDS.recordcount > 0 then
    begin
      OneStopServiceDM.OVstSeqCDS.edit;
      OneStopServiceDM.OVstSeqCDS.post;
    end;
  end;

  if OneStopServiceDM.OVstSeqCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta(OneStopServiceDM.OVstSeqCDS.delta,
      'select * from ovst_seq where vn = "' + FVN + '"');
  end;

  if not FDoctorWorkBenchMode then
  begin

    tc := TClientDataSet.Create(nil);
    tc.data := hosxp_getdataset('select * from opd_dep_queue where vn = "' + FVN
      + '" and depcode="' + fcomputerdepcode + '"');
    if tc.recordcount > 0 then
    begin
      tc.edit;

      tc.FieldByName('tx_status').asstring := 'Y';
      tc.FieldByName('check_in').asstring := 'N';
      tc.post;
    end;
    if tc.ChangeCount > 0 then
      hosxp_updatedelta(tc.delta, 'select * from opd_dep_queue where vn = "' +
        FVN + '" and depcode="' + fcomputerdepcode + '"');

    if OneStopServiceDM.OVstCDS.FieldByName('cur_dep').asstring <> '' then

    begin
      tc.data := hosxp_getdataset('select * from opd_dep_queue where vn = "' +
        FVN + '" and depcode="' + OneStopServiceDM.OVstCDS.FieldByName
        ('cur_dep').asstring + '"');

      if tc.recordcount = 0 then
      begin
        tc.append;
        repeat
          tc.FieldByName('opd_dep_queue_id').AsInteger :=
            getserialnumber('opd_dep_queue_id');
        until getsqldata
          ('select count(*) as cc from opd_dep_queue where opd_dep_queue_id = '
          + tc.FieldByName('opd_dep_queue_id').asstring) = 0;

        tc.FieldByName('depcode').asstring :=
          OneStopServiceDM.OVstCDS.FieldByName('cur_dep').asstring;
        tc.FieldByName('vn').asstring := FVN;
      end
      else
      begin
        tc.edit;
      end;
      tc.FieldByName('queue_datetime').AsDateTime := GetServerDateTime;
      tc.FieldByName('from_depcode').asstring := fcomputerdepcode;
      tc.FieldByName('tx_status').asstring := 'W';
      tc.FieldByName('check_in').asstring := 'N';
      if tc.FieldByName('day_queue_no').AsInteger = 0 then
      begin

        tc.FieldByName('day_queue_no').AsInteger :=
          getserialnumber('day_queue_no_' + formatdatetime('yyyymmdd',
          getsqldata('select vstdate from ovst where vn = "' + FVN + '"')) + '_'
          + tc.FieldByName('depcode').asstring);

      end;

      tc.post;

      if tc.ChangeCount > 0 then
        hosxp_updatedelta(tc.delta, 'select * from opd_dep_queue where vn = "' +
          FVN + '" and depcode="' + OneStopServiceDM.OVstCDS.FieldByName
          ('cur_dep').asstring + '"');
    end;

    tc.Free;
  end;

  if not FDoctorWorkBenchMode then

    if assigned(FMedicationOrderFrame) then
      ExecuteRTTIObjectMethod(FMedicationOrderFrame, 'DoSaveData', []);

  if not FDoctorWorkBenchMode then
    if assigned(HOSxPSubModuleOneStopServiceDM) then

      ExecuteRTTIObjectMethod(HOSxPSubModuleOneStopServiceDM,
        'SaveVisitData', []);

  if not FDoctorWorkBenchMode then
    if assigned(FDoctorWorkBenchPhysicalExaminationEntryFrame) then
    begin
      ExecuteRTTIObjectMethod(FDoctorWorkBenchPhysicalExaminationEntryFrame,
        'DoSaveData', []);
    end;

  PersonANCScreenCDS.edit;
  try
    PersonANCScreenCDS.FieldByName('bw').asfloat :=
      getsqldata('select bw from opdscreen where vn = "' + FVN + '"');

    if isnan(PersonANCScreenCDS.FieldByName('bw').asfloat) then
    begin
      PersonANCScreenCDS.FieldByName('bw').asvariant := null;
    end
    else

      if IsInfinite(PersonANCScreenCDS.FieldByName('bw').asfloat) then
    begin
      PersonANCScreenCDS.FieldByName('bw').asvariant := null;
    end;

  except
    PersonANCScreenCDS.FieldByName('bw').asvariant := null;
  end;

  try
    PersonANCScreenCDS.FieldByName('height').asfloat :=
      getsqldata('select height from opdscreen where vn = "' + FVN + '"');

    if isnan(PersonANCScreenCDS.FieldByName('height').asfloat) then
    begin
      PersonANCScreenCDS.FieldByName('height').asvariant := null;
    end
    else

      if IsInfinite(PersonANCScreenCDS.FieldByName('height').asfloat) then
    begin
      PersonANCScreenCDS.FieldByName('height').asvariant := null;
    end;

  except
    PersonANCScreenCDS.FieldByName('height').asvariant := null;
  end;
  // try  PersonANCScreenCDS.fieldbyname('bmi').AsFloat:=getsqldata('select bmi from opdscreen where vn = "'+fvn+'"');  except end;
  try
    PersonANCScreenCDS.FieldByName('bps').AsInteger :=
      getsqldata('select bps from opdscreen where vn = "' + FVN + '"');

    if isnan(PersonANCScreenCDS.FieldByName('bps').asfloat) then
    begin
      PersonANCScreenCDS.FieldByName('bps').asvariant := null;
    end
    else

      if IsInfinite(PersonANCScreenCDS.FieldByName('bps').asfloat) then
    begin
      PersonANCScreenCDS.FieldByName('bps').asvariant := null;
    end;

  except
    PersonANCScreenCDS.FieldByName('bps').asvariant := null;
  end;
  try
    PersonANCScreenCDS.FieldByName('bpd').AsInteger :=
      getsqldata('select bpd from opdscreen where vn = "' + FVN + '"');

    if isnan(PersonANCScreenCDS.FieldByName('bpd').asfloat) then
    begin
      PersonANCScreenCDS.FieldByName('bpd').asvariant := null;
    end
    else

      if IsInfinite(PersonANCScreenCDS.FieldByName('bpd').asfloat) then
    begin
      PersonANCScreenCDS.FieldByName('bpd').asvariant := null;
    end;

  except
    PersonANCScreenCDS.FieldByName('bpd').asvariant := null;
  end;

  try
    PersonANCScreenCDS.FieldByName('bmi').asfloat :=

      (PersonANCScreenCDS.FieldByName('bw').asfloat * 100 * 10000) /
      ((PersonANCScreenCDS.FieldByName('height').asfloat *
      PersonANCScreenCDS.FieldByName('height').asfloat) * 21);

    if isnan(PersonANCScreenCDS.FieldByName('bmi').asfloat) then
    begin
      PersonANCScreenCDS.FieldByName('bmi').asvariant := null;
    end
    else

      if IsInfinite(PersonANCScreenCDS.FieldByName('bmi').asfloat) then
    begin
      PersonANCScreenCDS.FieldByName('bmi').asvariant := null;
    end;

  except
    PersonANCScreenCDS.FieldByName('bmi').asfloat := 0;
  end;

  PersonANCScreenCDS.post;

  if PersonANCScreenCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(

      PersonANCScreenCDS,
      'select * from person_anc_screen  where person_anc_service_id = ' +
      inttostr(FPersonANCServiceID), '', '', inttostr(FPersonANCServiceID));
    PersonANCScreenCDS.MergeChangeLog;
  end;

  resyncvn(FVN);

end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.InitializeDatamodule;
begin

  if assigned(FOneStopServiceDM) then
    exit;

  SafeLoadPackage('HOSxPDoctorWorkBenchPackage.bpl');

  self.FOneStopServiceDM := TOneStopServiceDM.Create(self);

  FOneStopServiceDM.fcheckdiagdoctor := true;

  FDoctorWorkBenchNurseScreenFrame :=
    TFrame(ExecuteRTTIFunction
    ('DoctorWorkBenchNurseScreenFrameUnit.TDoctorWorkBenchNurseScreenFrame',
    'Create', [ScreenTabSheet]).AsObject);
  FDoctorWorkBenchNurseScreenFrame.Align := alclient;
  FDoctorWorkBenchNurseScreenFrame.Parent := ScreenTabSheet;

  // ExecuteRTTIObjectMethod(FDoctorWorkBenchNurseScreenFrame,
  // 'SetTabSheetOnLeft', []);

  SetRTTIObjectProperty(FDoctorWorkBenchNurseScreenFrame, 'OneStopServiceDM',
    self.FOneStopServiceDM);

  SafeLoadPackage('HOSxPSubModulePackage.bpl');

  HOSxPSubModuleOneStopServiceDM :=
    TDataModule(ExecuteRTTIFunction
    ('HOSxPSubModuleOneStopServiceDMU.THOSxPSubModuleOneStopServiceDM',
    'create', [self]).AsObject);

  FHOSxPSubModuleOneStopServiceDiagnosisEntryFrame :=
    TFrame(ExecuteRTTIFunction
    ('HOSxPSubModuleOneStopServiceDiagnosisEntryUnit.THOSxPSubModuleOneStopServiceDiagnosisEntryFrame',
    'create', [DxGroupBox]).AsObject);
  FHOSxPSubModuleOneStopServiceDiagnosisEntryFrame.Parent := DxGroupBox;
  FHOSxPSubModuleOneStopServiceDiagnosisEntryFrame.Align := alclient;

  SetRTTIObjectProperty(FHOSxPSubModuleOneStopServiceDiagnosisEntryFrame,
    'HOSxPSubModuleOneStopServiceDM', HOSxPSubModuleOneStopServiceDM);

  ExecuteRTTIObjectMethod(HOSxPSubModuleOneStopServiceDM,
    'PrepareVisitData', [FVN]);

  SafeLoadPackage('HOSxPMedicationOrderPackage.bpl');
  FMedicationOrderFrame :=
    TFrame(ExecuteRTTIFunction
    ('HOSxPMedicationOrderFrameUnit.THOSxPMedicationOrderFrame', 'Create',
    [MedicationGroupBox]).AsObject);
  FMedicationOrderFrame.Parent := MedicationGroupBox;
  FMedicationOrderFrame.Align := alclient;
  // if assigned(FTabHostform) then
  // SetRTTIObjectProperty(FMedicationOrderFrame, 'TabHostForm', FTabHostform);

  SetRTTIObjectProperty(FMedicationOrderFrame, 'VN', self.FVN);

  FPatientInformationFrame :=
    TFrame(ExecuteRTTIFunction
    ('PatientInformationType2FrameUnit.TPatientInformationType2Frame', 'create',
    [self]).AsObject);
  FPatientInformationFrame.Parent := PatientInformationDetailGroupBox;
  FPatientInformationFrame.Align := alclient;

  SetRTTIObjectProperty(FPatientInformationFrame, 'HN',
    vartostr(getsqldata('select hn from ovst where vn = "' + FVN + '"')));

end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.RefreshData;
var
  i: Integer;
  avn: string;
  fhn: string;
  lc, rc: TClientDataSet;

  aDateTime:TDateTime;
begin

  cxPageControl1.ActivePageIndex := 0;

  if not assigned(HOSxPPCUAccount2DataModule) then
    HOSxPPCUAccount2DataModule := THOSxPPCUAccount2DataModule.Create
      (application);

  PersonANCServiceCDS.data :=
    hosxp_getdataset
    ('select * from person_anc_service where person_anc_service_id = ' +
    inttostr(FPersonANCServiceID));

  PersonANCScreenCDS.data := hosxp_getdataset
    ('select * from person_anc_screen  where person_anc_service_id = ' +
    inttostr(FPersonANCServiceID));

  if PersonANCScreenCDS.recordcount > 0 then
  begin
    for i := 1 to 10 do
    begin
      TcxCheckBox(findcomponent('cxDBCheckBox' + inttostr(i))).checked :=
        pos(TcxCheckBox(findcomponent('cxDBCheckBox' + inttostr(i))).caption,
        PersonANCScreenCDS.FieldByName('cc_text').asstring) > 0;

    end;

  end;

  if PersonANCServiceCDS.recordcount = 0 then
  begin

    aDateTime :=
    ExecuteRTTIFunction('GetSingleDateTimeFormUnit.TGetSingleDateTimeForm','DoShowForm',[GetServerDateTime]).AsExtended;

    PersonANCServiceCDS.append;
    PersonANCServiceCDS.FieldByName('anc_service_date').AsDateTime := trunc(aDateTime);
     // GetServerDate;
    PersonANCServiceCDS.FieldByName('anc_service_time').AsDateTime :=frac( aDateTime);
     // GetServerTime;

    if validhncode(GetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'HN')
      .asstring) then
      avn := ShowFindVisitDialog(GetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame,
        'HN').asstring, 0);

    if validvncode(avn) then
    begin
      PersonANCServiceCDS.FieldByName('anc_service_date').AsDateTime :=
        getsqldata('select vstdate from ovst where vn = "' + avn + '"');
      PersonANCServiceCDS.FieldByName('anc_service_time').AsDateTime :=
        getsqldata('select vsttime from ovst where vn = "' + avn + '"');

      SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VN', avn);
    end
    else
    begin

      SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VisitDate',
        PersonANCServiceCDS.FieldByName('anc_service_date').AsDateTime);
      SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VisitTime',
        PersonANCServiceCDS.FieldByName('anc_service_time').AsDateTime);
    end;

    if FDoctorWorkBenchMode then
    begin

      fhn := vartostr(getsqldata('select hn from patient where cid = "' +
        vartostr(getsqldata('select cid from person where person_id = ' +
        inttostr(PersonANCCDS.FieldByName('person_id').AsInteger))) + '"'));

      avn := vartostr(getsqldata('select vn from ovst where hn = "' + fhn +
        '" and vstdate = "' + formatdatetime('yyyy-mm-dd',
        PersonANCServiceCDS.FieldByName('anc_service_date').AsDateTime) +
        '" order by vn desc limit 1'));

      if avn <> '' then
      begin
        SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VN', avn);

      end
      else
      begin
        ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoCheckVisitVN', []);

        ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoSaveData', []);

      end;

    end
    else
    begin
      ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoCheckVisitVN', []);

      ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoSaveData', []);

    end;

    PersonANCServiceCDS.FieldByName('vn').asstring :=
      GetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VN').asstring;
  end
  else
  begin

    SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VisitDate',
      PersonANCServiceCDS.FieldByName('anc_service_date').AsDateTime);
    SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VisitTime',
      PersonANCServiceCDS.FieldByName('anc_service_time').AsDateTime);

    if validvncode(PersonANCServiceCDS.FieldByName('vn').asstring) then
    begin
      SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VN',
        PersonANCServiceCDS.FieldByName('vn').asstring);
    end
    else
    begin
      ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoCheckVisitVN', []);
      ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame, 'DoSaveData', []);
      PersonANCServiceCDS.edit;
      PersonANCServiceCDS.FieldByName('vn').asstring :=
        GetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'VN').asstring;

    end;

  end;

  ExecuteRTTIObjectMethod(FHOSxPPCUVisitEntryFrame,'SetReadonlyVisitData',[true]);

  FVN := PersonANCServiceCDS.FieldByName('vn').asstring;

  InitializeDatamodule;

  FOneStopServiceDM.OPDScreencds.close;
  FOneStopServiceDM.ovstdiagcds.close;
  FOneStopServiceDM.opitemrececds.close;

  FOneStopServiceDM.OVstCDS.data :=
    hosxp_getdataset('select * from ovst where vn = "' + FVN + '"');
  FOneStopServiceDM.OPDScreencds.data :=
    hosxp_getdataset('select * from opdscreen where vn = "' + FVN + '"');
   FOneStopServiceDM.OPDScreenROScds.data :=
    hosxp_getdataset('select * from opdscreen_ros where vn = "' + FVN + '"');

  FOneStopServiceDM.ovstdiagcds.data :=
    hosxp_getdataset('select * from ovstdiag where vn = "' + FVN +
    '" and substring(icd10,1,1) not in ("1","2","3","4","5","6","7","8","9","0")');
  FOneStopServiceDM.ovstdiagopercds.data :=
    hosxp_getdataset('select * from ovstdiag where vn = "' + FVN +
    '"  and substring(icd10,1,1)  in ("1","2","3","4","5","6","7","8","9","0") order by diagtype,icd10');

  // FOneStopServiceDM.opitemrececds.data :=
  // hosxp_getdataset('select * from opitemrece where vn = "' + FVN + '"');

  FOneStopServiceDM.OVstSeqCDS.data :=
    hosxp_getdataset('select * from ovst_seq where vn = "' + FVN + '"');

  SetRTTIObjectProperty(FDoctorWorkBenchNurseScreenFrame, 'VN', FVN);

  PersonANCLabCDS.data := hosxp_getdataset
    ('select * from person_anc_lab where person_anc_service_id = ' +
    inttostr(FPersonANCServiceID));

  rc := TClientDataSet.Create(nil);
  lc := TClientDataSet.Create(nil);
  lc.data := hosxp_getdataset('select * from anc_lab ');
  while not lc.eof do
  begin
    if lc.FieldByName('lab_items_code').AsInteger > 0 then
    begin
      if not PersonANCLabCDS.locate('anc_lab_id',
        vararrayof([lc.FieldByName('anc_lab_id').AsInteger]), []) then
      begin
        if getsqldata
          ('select count(l1.lab_items_code) as cc from lab_order l1,lab_head l2 '
          + '  where l1.lab_order_number = l2.lab_order_number and l2.vn = "' +
          FVN + '" and ' + ' l1.lab_items_code=' +
          lc.FieldByName('lab_items_code').asstring) > 0 then
        begin
          rc.data := hosxp_getdataset
            ('select l1.* from lab_order l1,lab_head l2 ' +
            '  where l1.lab_order_number = l2.lab_order_number and l2.vn = "' +
            FVN + '" and ' + ' l1.lab_items_code=' +
            lc.FieldByName('lab_items_code').asstring + ' and l1.confirm="Y" ');
          if rc.recordcount > 0 then
            if rc.FieldByName('lab_order_result').asstring <> '' then
            begin
              PersonANCLabCDS.append;
              PersonANCLabCDS.FieldByName('anc_lab_id').AsInteger :=
                lc.FieldByName('anc_lab_id').AsInteger;
              PersonANCLabCDS.FieldByName('anc_lab_result').asstring :=
                rc.FieldByName('lab_order_result').asstring;
              PersonANCLabCDS.post;

            end;

        end;

      end
      else
      begin
        if getsqldata
          ('select count(l1.lab_items_code) as cc from lab_order l1,lab_head l2 '
          + '  where l1.lab_order_number = l2.lab_order_number and l2.vn = "' +
          FVN + '" and ' + ' l1.lab_items_code=' +
          lc.FieldByName('lab_items_code').asstring) > 0 then
        begin
          rc.data := hosxp_getdataset
            ('select l1.* from lab_order l1,lab_head l2 ' +
            '  where l1.lab_order_number = l2.lab_order_number and l2.vn = "' +
            FVN + '" and ' + ' l1.lab_items_code=' +
            lc.FieldByName('lab_items_code').asstring + ' and l1.confirm="Y" ');
          if rc.recordcount > 0 then
            if trim(PersonANCLabCDS.FieldByName('anc_lab_result').asstring)
              = '' then
              if rc.FieldByName('lab_order_result').asstring <> '' then
              begin
                PersonANCLabCDS.edit;
                PersonANCLabCDS.FieldByName('anc_lab_id').AsInteger :=
                  lc.FieldByName('anc_lab_id').AsInteger;
                PersonANCLabCDS.FieldByName('anc_lab_result').asstring :=
                  rc.FieldByName('lab_order_result').asstring;
                PersonANCLabCDS.post;

              end;

        end;

      end;
    end;

    lc.next;
  end;

  lc.Free;
  rc.Free;
  if PersonANCLabCDS.ChangeCount > 0 then
    hosxp_updatedelta(

      PersonANCLabCDS.delta,
      'select * from person_anc_lab where person_anc_service_id = ' +
      inttostr(FPersonANCServiceID));
    PersonANCLabCDS.close;

  if FDoctorWorkBenchMode then
  begin

    VisitTabSheet.TabVisible := false;
    ScreenTabSheet.TabVisible := false;
    Petabsheet.TabVisible := false;
    cxTabSheet1.TabVisible := false;
    cxTabSheet3.TabVisible := false;
    cxTabSheet4.TabVisible := false;
    cxTabSheet5.TabVisible := false;
    AppointmentTabSheet.TabVisible := false;
    ShowAllButton.Visible:=true;
    // VaccineTabSheet.TabVisible := false;

    // FDoctorWorkBenchMode:=false;
  end;

end;

class procedure THOSxPPCUAccount2ANCServiceEntryFrame.SetDoctorWorkBenchMode
  (b: boolean);
begin
  FDoctorWorkBenchMode := b;
end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.SetPersonANCID
  (const Value: Integer);
begin

  if not assigned(FHOSxPPCUVisitEntryFrame) then
  begin
    FHOSxPPCUVisitEntryFrame :=
      TFrame(ExecuteRTTIFunction
      ('HOSxPPCUVisitEntryFrameUnit.THOSxPPCUVisitEntryFrame', 'Create',
      [VisitGroupBox]).AsObject);
    FHOSxPPCUVisitEntryFrame.Parent := VisitGroupBox;
    FHOSxPPCUVisitEntryFrame.Align := alclient;
  end;

  FPersonANCID := Value;
  PersonANCCDS.data := hosxp_getdataset
    ('select * from person_anc where person_anc_id = ' +
    inttostr(FPersonANCID));
  if PersonANCCDS.recordcount > 0 then
  begin
    SetRTTIObjectProperty(FHOSxPPCUVisitEntryFrame, 'PersonID',
      PersonANCCDS.FieldByName('person_id').AsInteger);
  end;
end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.SetPersonANCServiceID
  (const Value: Integer);
begin
  FPersonANCServiceID := Value;
  if FPersonANCServiceID = 0 then
  begin
    repeat
      FPersonANCServiceID := getserialnumber('person_anc_service_id');
      // GetNewCodeFromTable('person_anc_service', 'person_anc_service_id', '', '001', 3);
    until getsqldata
      ('select count(*) as cc from person_anc_service where person_anc_service_id = '
      + inttostr(FPersonANCServiceID)) = 0;
  end;
  RefreshData;
end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.ShowAllButtonClick(Sender: TObject);
begin
  VisitTabSheet.TabVisible := true;
    ScreenTabSheet.TabVisible := true;
    Petabsheet.TabVisible := true;
    cxTabSheet1.TabVisible := true;
    cxTabSheet3.TabVisible := true;
    cxTabSheet4.TabVisible := true;
    cxTabSheet5.TabVisible := true;
    AppointmentTabSheet.TabVisible := true;
    ShowAllButton.Visible:=false;
end;

procedure THOSxPPCUAccount2ANCServiceEntryFrame.VaccineTabSheetShow
  (Sender: TObject);
var oldMode:boolean;
begin


  oldmode:=FDoctorWorkBenchMode;
  FDoctorWorkBenchMode:=true;

 // if getsqldata('select count(*) as cc from ovst where vn = "'+fvn+'"')=0 then
 screen.Cursor:=crhourglass;
  dosavedata;
  screen.Cursor:=crdefault;

  FDoctorWorkBenchMode:=oldmode;

  if not assigned(FHOSxPPCUAccount2PersonAncServiceDetailListFrame) then
  begin
    FHOSxPPCUAccount2PersonAncServiceDetailListFrame :=
      TFrame(ExecuteRTTIFunction
      ('HOSxPPCUAccount2PersonAncServiceDetailListFrameUnit.THOSxPPCUAccount2PersonAncServiceDetailListFrame',
      'Create', [VaccineTabSheet]).AsObject);
    FHOSxPPCUAccount2PersonAncServiceDetailListFrame.Parent := VaccineTabSheet;
    FHOSxPPCUAccount2PersonAncServiceDetailListFrame.Align := alclient;
  end;

  SetRTTIObjectProperty(FHOSxPPCUAccount2PersonAncServiceDetailListFrame,
    'PersonANCServiceID', self.FPersonANCServiceID);

  SetRTTIObjectProperty(FHOSxPPCUAccount2PersonAncServiceDetailListFrame,
    'VN', self.Fvn);
end;

end.
